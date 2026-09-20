-- Apply after 202609170002_razorpay_checkout.sql.
-- Unpaid requests contain contact/course information, never passwords or Auth users.
begin;
alter table public.pending_users add column if not exists request_kind text default 'legacy';
create table tis_private.signup_approvals (
 pending_id uuid primary key references public.pending_users(id),
 token uuid not null default gen_random_uuid(),
 approved_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
revoke all on tis_private.signup_approvals from public,anon,authenticated;

create function public.tis_request_signup(p_email text,p_name text,p_phone text,p_course text,p_referral text,p_ip text)
returns void language plpgsql security definer set search_path='' as $$
declare ref uuid; title text;
begin
 p_email:=lower(trim(p_email));
 perform pg_advisory_xact_lock(hashtextextended(p_email,17));
 if length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or length(trim(p_name)) not between 2 and 120 or p_phone !~ '^\+?[0-9 ()-]{8,20}$' then
 raise exception 'Enter a valid name, email and phone number'; end if;
 if tis_private.price(p_course) is null then raise exception 'Unknown course'; end if;
 title:=initcap(lower(trim(p_course)));
 ref:=tis_private.referrer(p_referral);
 if nullif(trim(p_referral),'') is not null and (ref is null or exists(select 1 from auth.users where id=ref and lower(email)=p_email)) then
 raise exception 'Invalid referral link'; end if;
 -- Repeated/public requests never disclose or overwrite an existing account/request.
 if exists(select 1 from auth.users where lower(email)=p_email)
 or exists(select 1 from public.pending_users where lower(trim(email))=p_email and status='pending') then return; end if;
 if (select count(*) from public.pending_users where request_kind='admin_request'
 and payment_details->>'ip_hash'=p_ip and created_at>now()-interval '1 hour')>=20 then
 raise exception 'Too many signup requests. Please try again later'; end if;
 insert into public.pending_users(full_name,phone,email,package_name,payment_method,payment_details,
 referrer_id,referral_code,paid_price,status,request_kind)
 values(trim(p_name),trim(p_phone),p_email,title,'Admin approval requested',
 jsonb_build_object('payment_collected',false,'ip_hash',p_ip),ref,ref::text,0,'pending','admin_request');
end $$;
revoke all on function public.tis_request_signup(text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.tis_request_signup(text,text,text,text,text,text) to service_role;

-- Only a verified administrator can issue the private capability used by Auth.
create function public.tis_begin_signup_approval(p_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.pending_users; capability uuid;
begin
 if not tis_private.is_admin() then raise exception 'Administrator access required'; end if;
 select * into strict p from public.pending_users where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended(lower(trim(p.email)),17));
 select * into strict p from public.pending_users where id=p_id for update;
 if p.status='approved' then return null; end if;
 if p.status<>'pending' then raise exception 'Signup is not pending'; end if;
 if exists(select 1 from public.tis_payment_sessions where email=lower(trim(p.email))
 and (status='paid' or (status='created' and expires_at>now()))) then
 raise exception 'Payment is in progress. Check its status before approving this signup'; end if;
 if p.referrer_id is not null and tis_private.referrer(p.referrer_id::text) is distinct from p.referrer_id then
 raise exception 'Invalid referral link'; end if;
 insert into tis_private.signup_approvals(pending_id,approved_by) values(p.id,auth.uid()) on conflict(pending_id) do nothing;
 select token into capability from tis_private.signup_approvals where pending_id=p.id;
 return capability;
end $$;
revoke all on function public.tis_begin_signup_approval(uuid) from public,anon;
grant execute on function public.tis_begin_signup_approval(uuid) to authenticated;

create or replace function tis_private.require_paid_signup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.tis_payment_sessions s where s.id::text=new.raw_user_meta_data->>'paid_checkout_id'
 and s.email=lower(trim(new.email)) and s.status='paid' and s.payment_id is not null and s.user_id is null) then return new; end if;
 if exists(select 1 from public.pending_users p join tis_private.signup_approvals a on a.pending_id=p.id
 where p.id::text=new.raw_user_meta_data->>'approved_signup_id'
 and a.token::text=new.raw_user_meta_data->>'approval_token'
 and lower(trim(p.email))=lower(trim(new.email)) and p.status='pending') then
 -- The private capability must not become readable user metadata or a JWT claim.
 new.raw_user_meta_data:=new.raw_user_meta_data-'approval_token';
 return new;
 end if;
 raise exception 'Complete a verified course payment or wait for administrator approval before creating an account';
end $$;

create function public.tis_signup_account(p_id uuid) returns uuid
language sql security definer set search_path='' as $$
 select u.id from auth.users u join public.pending_users p on lower(trim(p.email))=lower(u.email)
 where p.id=p_id and exists(select 1 from tis_private.signup_approvals a where a.pending_id=p.id);
$$;
revoke all on function public.tis_signup_account(uuid) from public,anon,authenticated;
grant execute on function public.tis_signup_account(uuid) to service_role;

create or replace function public.tis_approve_legacy(p_id text,p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare pending public.pending_users; enrollment_id text;
begin
 if not tis_private.is_admin() then raise exception 'Administrator access required'; end if;
 select * into strict pending from public.pending_users where id::text=p_id for update;
 if pending.status='approved' then return; end if;
 if pending.status<>'pending' then raise exception 'Signup is not pending'; end if;
 if not exists(select 1 from auth.users where id=p_user and lower(email)=lower(trim(pending.email))) then
 raise exception 'Auth account does not match signup'; end if;
 if pending.request_kind='admin_request' and not exists(select 1 from tis_private.signup_approvals where pending_id=pending.id) then
 raise exception 'Administrator must authorize account creation first'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 -- A concurrent captured payment may have already granted this course and reward.
 select id::text into enrollment_id from public."Enrollments" where user_id=p_user
 and lower(trim(course_name))=lower(trim(pending.package_name)) and lower(status) in ('approved','active') limit 1;
 if enrollment_id is null then
  if exists(select 1 from public."Enrollments" where user_id=p_user and lower(trim(course_name))=lower(trim(pending.package_name)) and lower(status)='pending') then
   raise exception 'This course already has a pending enrollment. Review that enrollment instead'; end if;
  if pending.referrer_id is not null and (pending.referrer_id=p_user or tis_private.referrer(pending.referrer_id::text) is distinct from pending.referrer_id) then
   raise exception 'Invalid referral link'; end if;
  insert into public."Enrollments"(user_id,email,full_name,phone,course_name,package_name,payment_method,payment_details,amount,referrer_id,referral_code,status)
  values(p_user,pending.email,pending.full_name,pending.phone,pending.package_name,pending.package_name,pending.payment_method,pending.payment_details,
  case when pending.request_kind='admin_request' then 0 else coalesce(nullif(pending.paid_price,0),(to_jsonb(pending)->>'referral_discount_price')::numeric,0) end,
  pending.referrer_id,pending.referral_code,'pending') returning id::text into enrollment_id;
  perform public.tis_approve_enrollment(enrollment_id);
 end if;
 update public.pending_users set status='approved',approved_user_id=p_user,approved_at=now() where id=pending.id;
 delete from tis_private.signup_approvals where pending_id=pending.id;
end $$;

-- Paid email ownership also covers an account created by a concurrent admin approval.
create or replace function public.tis_checkout_account(p_session uuid) returns uuid
language sql security definer set search_path='' as $$
 select u.id from auth.users u join public.tis_payment_sessions s on lower(u.email)=s.email
 where s.id=p_session and s.status in ('paid','completed') and s.payment_id is not null;
$$;

-- Do not begin a new checkout while an administrator is provisioning this email.
create function tis_private.guard_checkout_approval() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.pending_users p join tis_private.signup_approvals a on a.pending_id=p.id
 where lower(trim(p.email))=new.email and p.status='pending') then
 raise exception 'Administrator approval is in progress. Please wait for your account email'; end if;
 return new;
end $$;
create trigger tis_checkout_approval_guard before insert on public.tis_payment_sessions
for each row execute function tis_private.guard_checkout_approval();

-- Clear matching requests after payment, without creating a second enrollment/reward.
create function tis_private.complete_paid_signup_request() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='completed' and old.status is distinct from 'completed' then
 update public.pending_users set status='approved',approved_user_id=new.user_id,approved_at=now()
 where lower(trim(email))=new.email and lower(trim(package_name))=lower(new.course) and status='pending' and request_kind='admin_request';
 delete from tis_private.signup_approvals a using public.pending_users p
 where a.pending_id=p.id and lower(trim(p.email))=new.email and lower(trim(p.package_name))=lower(new.course)
 and p.status='approved' and p.request_kind='admin_request';
 end if;
 return new;
end $$;
create trigger tis_paid_signup_request after update on public.tis_payment_sessions
for each row execute function tis_private.complete_paid_signup_request();
revoke all on function tis_private.guard_checkout_approval() from public,anon,authenticated;
revoke all on function tis_private.complete_paid_signup_request() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
