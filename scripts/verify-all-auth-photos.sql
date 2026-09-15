-- Run separately after 202609140001_auth_photo_tokens.sql. Read-only.
-- Reports every registered account; no image values, passwords or tokens.
select
  u.email,
  octet_length(coalesce(u.raw_user_meta_data, '{}'::jsonb)::text) as metadata_bytes,
  case
    when exists (
      select 1 from jsonb_each(coalesce(u.raw_user_meta_data, '{}'::jsonb)) f
      where f.key in ('avatar', 'profile_picture', 'avatar_url', 'picture')
        and jsonb_typeof(f.value) = 'string' and lower(f.value #>> '{}') like 'data:image/%'
    ) then 'NEEDS REPAIR: embedded photo data remains'
    when octet_length(coalesce(u.raw_user_meta_data, '{}'::jsonb)::text) > 8192
      then 'NEEDS REVIEW: other metadata is large'
    else 'OK: photo metadata clean'
  end as result,
  exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'zz_tis_remove_embedded_auth_photos'
      and tgenabled in ('O', 'A') and not tgisinternal
      and tgfoid = to_regprocedure('tis_auth_repair_archive.remove_embedded_photos()')
  ) as future_photo_protection
from auth.users u order by u.email;
