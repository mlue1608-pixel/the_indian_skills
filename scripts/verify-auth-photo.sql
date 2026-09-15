-- Read-only, independent of the repair connection. Replace the email below.
-- Reports sizes/status only; never image contents, passwords, or tokens.
select
  email,
  octet_length(coalesce(raw_user_meta_data, '{}'::jsonb)::text) as metadata_bytes,
  case
    when lower(coalesce(raw_user_meta_data ->> 'avatar', '')) like 'data:image/%'
      or lower(coalesce(raw_user_meta_data ->> 'profile_picture', '')) like 'data:image/%'
      then 'Embedded photo metadata is still present.'
    when octet_length(coalesce(raw_user_meta_data, '{}'::jsonb)::text) > 8192
      then 'Other metadata is still large; inspect its field sizes.'
    else 'No embedded photo fields remain. Sign in again to issue a new token.'
  end as result
from auth.users
where lower(email) = lower('REPLACE_WITH_LOGIN_EMAIL');
