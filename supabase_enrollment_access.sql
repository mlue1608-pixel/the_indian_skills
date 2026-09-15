-- Run in the Supabase SQL editor. This script does not create another enrollment table.
-- Inspect possible duplicate tables and existing policies before applying the repair.
select table_schema, table_name
from information_schema.tables
where table_schema not in ('pg_catalog', 'information_schema')
  and lower(table_name) in ('enrollments', 'user_courses');

select policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'Enrollments';

-- Actual RLS state and table/schema privileges (not inferred from setup files).
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
       has_schema_privilege('authenticated', n.oid, 'USAGE') as schema_usage,
       has_table_privilege('authenticated', c.oid, 'SELECT') as can_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
  and lower(c.relname) in ('enrollments', 'user_courses');

select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and lower(table_name) in ('enrollments', 'user_courses')
order by table_name, ordinal_position;

-- Restrictive policies still apply alongside the new permissive owner policy.
-- Profile-dependent policies can also fail if profiles has recursive/broken RLS.
select tablename, policyname, permissive, roles, cmd, qual
from pg_policies
where schemaname = 'public' and tablename in ('Enrollments', 'profiles');

-- Locate the reported user without treating the displayed prefix as a full UUID.
select e.user_id, e.course_name, e.status
from public."Enrollments" e
where e.user_id::text like 'a2a09041-771%';

begin;
do $$
begin
  if to_regclass('public."Enrollments"') is null then
    raise exception 'Expected public."Enrollments" is missing. Review the table audit; do not create a duplicate table.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'Enrollments'
      and column_name = 'user_id' and data_type = 'uuid'
  ) then
    raise exception 'Enrollments.user_id must be the authenticated user UUID. Review the schema before applying this repair.';
  end if;
end $$;
grant usage on schema public to authenticated;
alter table public."Enrollments" enable row level security;
grant select on public."Enrollments" to authenticated;
drop policy if exists "Enrollment owners can select" on public."Enrollments";
create policy "Enrollment owners can select"
on public."Enrollments" for select to authenticated
using (
  (select auth.uid()) = user_id
  or lower(coalesce(email, '')) = lower(coalesce(auth.email(), ''))
);
commit;

-- Audit legacy rows separately. Do not assign ownership automatically from email.
-- After verifying ownership, an administrator can link these rows to the full auth UUID.
select course_name, status, count(*) as unlinked_records
from public."Enrollments"
where user_id is null
group by course_name, status;

-- Validate using the affected user's authenticated browser session after applying.
-- SQL editor queries normally bypass RLS and alone cannot prove user access.
-- Existing restrictive policies or policies that error must also be reviewed.
