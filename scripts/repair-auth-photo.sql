-- Run this whole file in the configured project's Supabase SQL Editor.
-- Replace REPLACE_WITH_LOGIN_EMAIL below with the affected login email.
-- This targets ONE account, archives embedded photos privately, and removes
-- only those photo fields from Auth metadata. It does not change passwords,
-- account IDs, roles, approvals, enrollment records, or other metadata.
-- This is ONE atomic SQL statement with no temporary tables or manual
-- BEGIN/COMMIT dependency. On success the editor may say "No rows returned".
-- Then run verify-auth-photo.sql and sign in again to get a smaller token.
do $repair$
declare
  target_email text := 'REPLACE_WITH_LOGIN_EMAIL';
  target_id uuid;
  original_metadata jsonb;
  cleaned_metadata jsonb;
  photo_backup jsonb := '{}'::jsonb;
  photo_key text;
  bytes_before integer;
  bytes_after integer;
begin
  perform set_config('lock_timeout', '5s', true);
  if target_email = 'REPLACE_WITH_LOGIN_EMAIL' or position('@' in target_email) = 0 then
    raise exception 'Set target_email to the affected login email before running this repair.';
  end if;

  -- STRICT fails if the email matches zero or multiple accounts. Lock the row
  -- so a concurrent profile update cannot be overwritten by this repair.
  select id, coalesce(raw_user_meta_data, '{}'::jsonb)
    into strict target_id, original_metadata
    from auth.users where lower(email) = lower(trim(target_email)) for update;

  bytes_before := octet_length(original_metadata::text);
  cleaned_metadata := original_metadata;
  foreach photo_key in array array['avatar', 'profile_picture'] loop
    if jsonb_typeof(original_metadata -> photo_key) = 'string'
       and lower(original_metadata ->> photo_key) like 'data:image/%' then
      photo_backup := photo_backup || jsonb_build_object(photo_key, original_metadata -> photo_key);
      cleaned_metadata := cleaned_metadata - photo_key;
    end if;
  end loop;

  if photo_backup = '{}'::jsonb then
    raise notice 'No embedded photo fields found; account was not changed. Metadata size: % bytes.', bytes_before;
    return;
  end if;

  bytes_after := octet_length(cleaned_metadata::text);
  if bytes_after > 8192 then
    raise exception 'Other metadata is also large (% bytes after removing photos). No changes were committed; investigate its field sizes first.', bytes_after;
  end if;

  -- All backup setup, archiving, and the update run inside the same statement.
  -- Any exception rolls everything back, including the backup insert.
  create schema if not exists tis_auth_repair_archive;
  revoke all on schema tis_auth_repair_archive from public, anon, authenticated;
  create table if not exists tis_auth_repair_archive.profile_photos (
    id bigint generated always as identity primary key,
    user_id uuid not null,
    photo_metadata jsonb not null,
    metadata_bytes_before integer not null,
    metadata_bytes_after integer not null,
    archived_at timestamptz not null default now()
  );
  alter table tis_auth_repair_archive.profile_photos enable row level security;
  revoke all on table tis_auth_repair_archive.profile_photos from public, anon, authenticated;

  insert into tis_auth_repair_archive.profile_photos
    (user_id, photo_metadata, metadata_bytes_before, metadata_bytes_after)
    values (target_id, photo_backup, bytes_before, bytes_after);

  update auth.users set raw_user_meta_data = cleaned_metadata, updated_at = now()
    where id = target_id;

  -- Fail and roll back if a project-specific trigger rewrites the metadata.
  if (select raw_user_meta_data from auth.users where id = target_id) is distinct from cleaned_metadata then
    raise exception 'A database trigger changed the result. Repair rolled back; inspect the trigger before retrying.';
  end if;

  raise notice 'Photo metadata archived and repaired: % -> % bytes. Sign in again to get a smaller token.', bytes_before, bytes_after;
end;
$repair$;
