-- Run after supabase_enrollment_access.sql in the SQL editor.
-- Read-only verification under the affected user's role, with rollback.
-- Change the prefix if testing another user. Never use this impersonation in browser code.
begin;
do $$
declare
  target_user uuid;
  matches integer;
begin
  select count(*) into matches from auth.users
  where id::text like 'a2a09041-771%';
  if matches <> 1 then
    raise exception 'User prefix must match exactly one auth user; found %', matches;
  end if;
  select id into target_user from auth.users
  where id::text like 'a2a09041-771%';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', target_user::text, 'role', 'authenticated'
  )::text, true);
end $$;

-- Baseline under the SQL editor role, before RLS is applied.
select count(*) as expected_active_enrollments
from public."Enrollments"
where user_id = auth.uid() and status in ('approved', 'active');

set local role authenticated;
select current_user as database_role, auth.uid() as authenticated_user;

-- This matches the dashboard query, including columns and active statuses.
select course_name, user_id, status, created_at, amount
from public."Enrollments"
where user_id = auth.uid() and status in ('approved', 'active')
order by created_at desc;

-- Expected zero for an ordinary user. A nonzero count means another policy
-- grants broader access and needs review; permissive policies combine with OR.
select count(*) as other_users_visible
from public."Enrollments"
where user_id is distinct from auth.uid();
rollback;
-- If any statement fails, run ROLLBACK before starting another SQL editor query.
