-- Read-only: run in the Supabase SQL Editor for an administrator's inspection.
-- Lists sizes for oversized user metadata. It does not return metadata values,
-- images, passwords, access tokens, or refresh tokens.
select
  u.id,
  u.email,
  octet_length(u.raw_user_meta_data::text) as user_metadata_bytes,
  field.key as metadata_field,
  octet_length(field.value::text) as field_bytes,
  coalesce(jsonb_typeof(field.value) = 'string'
    and lower(field.value #>> '{}') like 'data:image/%', false) as embedded_image
from auth.users u
cross join lateral jsonb_each(coalesce(u.raw_user_meta_data, '{}'::jsonb)) field
where octet_length(u.raw_user_meta_data::text) > 8192
order by user_metadata_bytes desc, field_bytes desc;
