-- Admin approval is the confirmation step for manually approved signup requests.
-- Course activation, referral credit and account confirmation commit together.
begin;
create function public.tis_finish_admin_signup(p_id text,p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare pending public.pending_users;
begin
 if not tis_private.is_admin() then raise exception 'Administrator access required'; end if;
 select * into strict pending from public.pending_users where id::text=p_id for update;
 if not exists(select 1 from auth.users where id=p_user and lower(email)=lower(trim(pending.email))) then
 raise exception 'Auth account does not match signup'; end if;
 perform public.tis_approve_legacy(p_id,p_user);
 if not exists(select 1 from public.pending_users where id::text=p_id and status='approved' and approved_user_id=p_user)
 or not exists(select 1 from public."Enrollments" where user_id=p_user and lower(trim(course_name))=lower(trim(pending.package_name)) and lower(status) in ('approved','active')) then
 raise exception 'Course approval is incomplete'; end if;
 -- Password remains the hash imported by the Auth admin API. Do not reset it.
 update auth.users set email_confirmed_at=coalesce(email_confirmed_at,now()),updated_at=now() where id=p_user;
 update auth.identities set identity_data=coalesce(identity_data,'{}'::jsonb)||'{"email_verified":true}'::jsonb,
 updated_at=now() where user_id=p_user and provider='email';
end $$;
revoke all on function public.tis_finish_admin_signup(text,uuid) from public,anon;
grant execute on function public.tis_finish_admin_signup(text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
