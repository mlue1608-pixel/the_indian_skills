-- Run the WHOLE file once in Supabase SQL Editor. No email replacement needed.
-- Repairs all accounts with embedded profile photos and protects future Auth
-- inserts/updates. Photos are archived privately; account IDs, passwords,
-- roles, approvals, enrollment records and non-photo metadata are preserved.
-- One atomic statement; "Success. No rows returned" is expected.
do $migration$
declare
  repaired_accounts integer;
begin
  perform set_config('lock_timeout', '5s', true);
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

  execute $function$
    create or replace function tis_auth_repair_archive.remove_embedded_photos()
    returns trigger language plpgsql security definer set search_path = '' as $body$
    declare
      original_metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
      cleaned_metadata jsonb := original_metadata;
      photo_backup jsonb := '{}'::jsonb;
      photo_key text;
    begin
      foreach photo_key in array array['avatar', 'profile_picture', 'avatar_url', 'picture'] loop
        if jsonb_typeof(original_metadata -> photo_key) = 'string'
           and lower(original_metadata ->> photo_key) like 'data:image/%' then
          photo_backup := photo_backup || jsonb_build_object(photo_key, original_metadata -> photo_key);
          cleaned_metadata := cleaned_metadata - photo_key;
        end if;
      end loop;
      if photo_backup <> '{}'::jsonb then
        insert into tis_auth_repair_archive.profile_photos
          (user_id, photo_metadata, metadata_bytes_before, metadata_bytes_after)
          values (new.id, photo_backup, octet_length(original_metadata::text), octet_length(cleaned_metadata::text));
        new.raw_user_meta_data := cleaned_metadata;
      end if;
      return new;
    end;
    $body$;
  $function$;
  revoke all on function tis_auth_repair_archive.remove_embedded_photos() from public, anon, authenticated;
  drop trigger if exists zz_tis_remove_embedded_auth_photos on auth.users;
  create trigger zz_tis_remove_embedded_auth_photos
    before insert or update of raw_user_meta_data on auth.users
    for each row execute function tis_auth_repair_archive.remove_embedded_photos();

  -- The trigger archives and cleans each affected account in this update.
  update auth.users u set raw_user_meta_data = u.raw_user_meta_data, updated_at = now()
  where exists (
    select 1 from jsonb_each(coalesce(u.raw_user_meta_data, '{}'::jsonb)) f
    where f.key in ('avatar', 'profile_picture', 'avatar_url', 'picture')
      and jsonb_typeof(f.value) = 'string'
      and lower(f.value #>> '{}') like 'data:image/%'
  );
  get diagnostics repaired_accounts = row_count;

  if exists (
    select 1 from auth.users u
    cross join lateral jsonb_each(coalesce(u.raw_user_meta_data, '{}'::jsonb)) f
    where f.key in ('avatar', 'profile_picture', 'avatar_url', 'picture')
      and jsonb_typeof(f.value) = 'string'
      and lower(f.value #>> '{}') like 'data:image/%'
  ) then
    raise exception 'Another Auth trigger reintroduced photo data. All changes rolled back; inspect that trigger.';
  end if;
  raise notice 'Repaired % accounts. Future Auth photo writes are protected. Run verify-all-auth-photos.sql next.', repaired_accounts;
end;
$migration$;
