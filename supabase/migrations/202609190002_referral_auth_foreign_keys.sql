-- Referral resolution returns auth.users.id. Older schemas instead require a
-- profiles row, which is not guaranteed for a legacy Auth account.
-- Preserve all referral IDs; enforce the canonical Auth identity on both paths.
begin;
set local lock_timeout='10s';
do $$
declare table_name text; constraint_row record; ref_attribute smallint; ref_type oid;
begin
 foreach table_name in array array['pending_users','Enrollments'] loop
  select attnum,atttypid into strict ref_attribute,ref_type from pg_attribute
  where attrelid=format('public.%I',table_name)::regclass and attname='referrer_id' and not attisdropped;
  for constraint_row in
   select c.conname,c.confrelid,c.confkey,c.conkey
   from pg_constraint c where c.conrelid=format('public.%I',table_name)::regclass
   and c.contype='f' and ref_attribute=any(c.conkey)
  loop
   if cardinality(constraint_row.conkey)<>1
    or constraint_row.confrelid not in ('public.profiles'::regclass,'auth.users'::regclass)
    or constraint_row.confkey<>array[(select attnum from pg_attribute where attrelid=constraint_row.confrelid and attname='id')]::smallint[] then
    raise exception 'Unexpected referral constraint on %. Inspect it before changing anything.',table_name;
   end if;
   execute format('alter table public.%I drop constraint %I',table_name,constraint_row.conname);
  end loop;
  -- Some legacy Enrollments tables stored Auth UUIDs as text.
  -- Invalid nonempty values fail the cast and roll back the entire repair.
  -- Empty/whitespace-only strings represent an absent referral and become NULL.
  if ref_type in ('text'::regtype,'character varying'::regtype) then
   execute format('alter table public.%I alter column referrer_id type uuid using nullif(btrim(referrer_id::text),'''')::uuid',table_name);
  elsif ref_type<>'uuid'::regtype then
   raise exception 'Unexpected referrer_id type on %. Inspect it before changing anything.',table_name;
  end if;
  -- Validation fails/rolls back if any existing referral is not an Auth user.
  execute format('alter table public.%I add constraint %I foreign key(referrer_id) references auth.users(id) on delete set null',
    table_name,table_name||'_referrer_id_fkey');
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
