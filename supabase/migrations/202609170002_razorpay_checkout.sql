-- Apply after 202609170001. No historical enrollments are changed.
begin;
create table public.tis_payment_sessions (
 id uuid primary key default gen_random_uuid(), token_hash text not null,
 email text not null, full_name text not null, phone text not null,
 user_id uuid references auth.users(id), course text not null, referrer_id uuid references auth.users(id),
 original_paise integer not null check(original_paise>0), amount_paise integer not null check(amount_paise>0),
 order_id text unique, payment_id text unique,
 status text not null default 'created' check(status in ('created','paid','completed','refund_required')),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '6 minutes',
 paid_at timestamptz, completed_at timestamptz, ip_hash text not null
);
create index tis_payment_email_time on public.tis_payment_sessions(email,created_at);
create index tis_payment_ip_time on public.tis_payment_sessions(ip_hash,created_at);
alter table public.tis_payment_sessions enable row level security;
revoke all on public.tis_payment_sessions from anon,authenticated;
grant all on public.tis_payment_sessions to service_role;
alter table public."Enrollments" add column if not exists checkout_id uuid unique references public.tis_payment_sessions(id);

create function public.tis_checkout_create(p_email text,p_name text,p_phone text,p_course text,p_referral text,p_user uuid,p_hash text,p_ip text)
returns public.tis_payment_sessions language plpgsql security definer set search_path='' as $$
declare price numeric; ref uuid; s public.tis_payment_sessions; existing uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(lower(trim(p_email)),17));
 select id into existing from auth.users where lower(email)=lower(trim(p_email));
 if p_user is null and existing is not null then raise exception 'Email already registered. Please sign in to buy a course.'; end if;
 if p_user is not null and (existing is null or existing<>p_user) then raise exception 'Account does not match email'; end if;
 if (select count(*) from public.tis_payment_sessions where email=lower(trim(p_email)) and created_at>now()-interval '1 hour')>=5
 or (select count(*) from public.tis_payment_sessions where ip_hash=p_ip and created_at>now()-interval '1 hour')>=30 then
 raise exception 'Too many payment attempts. Please try again later.'; end if;
 if exists(select 1 from public.tis_payment_sessions where email=lower(trim(p_email)) and
 (status='paid' or (status='created' and expires_at>now()))) then raise exception 'A payment session is already open. Return to it or wait six minutes.'; end if;
 price:=tis_private.price(p_course); if price is null then raise exception 'Unknown course'; end if;
 ref:=tis_private.referrer(p_referral);
 if nullif(trim(p_referral),'') is not null and (ref is null or ref=p_user) then raise exception 'Invalid referral link'; end if;
 if exists(select 1 from public."Enrollments" where (user_id=p_user or lower(trim(email))=lower(trim(p_email)))
 and lower(trim(course_name))=lower(trim(p_course)) and lower(status) in ('approved','active','pending')) then
 raise exception 'This course is already enrolled or awaiting approval'; end if;
 insert into public.tis_payment_sessions(token_hash,email,full_name,phone,user_id,course,referrer_id,original_paise,amount_paise,ip_hash)
 values(p_hash,lower(trim(p_email)),trim(p_name),trim(p_phone),p_user,initcap(lower(trim(p_course))),ref,(price*100)::integer,
 (round(price*case when ref is null then 1 else .30 end,2)*100)::integer,p_ip) returning * into s;
 return s;
end $$;

-- Service-only lookup supports safe retries after Auth invitation succeeds but the response is lost.
create function public.tis_checkout_account(p_session uuid) returns uuid
language sql security definer set search_path='' as $$
 select u.id from auth.users u join public.tis_payment_sessions s on lower(u.email)=s.email
 where s.id=p_session and (u.id=s.user_id or u.raw_user_meta_data->>'paid_checkout_id'=s.id::text);
$$;

create function public.tis_checkout_finish(p_session uuid,p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s public.tis_payment_sessions; enrollment text; new_balance numeric;
begin
 select * into strict s from public.tis_payment_sessions where id=p_session for update;
 if s.status='completed' then return; end if;
 if s.status<>'paid' or s.payment_id is null then raise exception 'Verified captured payment required'; end if;
 if public.tis_checkout_account(s.id) is distinct from p_user then raise exception 'Account does not match payment'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 if exists(select 1 from public."Enrollments" where user_id=p_user and lower(trim(course_name))=lower(s.course)
 and lower(status) in ('approved','active','pending')) then
 update public.tis_payment_sessions set status='refund_required' where id=s.id; return; end if;
 insert into public."Enrollments"(user_id,email,full_name,phone,course_name,package_name,status,payment_method,transaction_id,
 amount,referrer_id,referral_code,payment_details,approved_at,checkout_id)
 values(p_user,s.email,s.full_name,s.phone,s.course,s.course,'approved','Razorpay',s.payment_id,s.amount_paise/100.0,
 s.referrer_id,s.referrer_id::text,jsonb_build_object('order_id',s.order_id,'payment_id',s.payment_id,'original_price',s.original_paise/100.0),now(),s.id)
 returning id::text into enrollment;
 insert into public.profiles(id,full_name,phone,status,referral_code,referred_by)
 values(p_user,s.full_name,s.phone,'active',p_user::text,s.referrer_id)
 on conflict(id) do update set status='active',referred_by=coalesce(public.profiles.referred_by,excluded.referred_by);
 if s.referrer_id is not null and s.referrer_id<>p_user then
 insert into public.tis_approval_credits(enrollment_id,referrer_id) values(enrollment,s.referrer_id);
 insert into public.referral_cashback_wallet(user_id,balance) values(s.referrer_id,125)
 on conflict(user_id) do update set balance=public.referral_cashback_wallet.balance+125,updated_at=now() returning balance into new_balance;
 insert into public.referral_cashback_transactions(user_id,amount,type,source,balance_after,metadata)
 values(s.referrer_id,125,'credit','approved_referral_purchase',new_balance,jsonb_build_object('enrollment_id',enrollment));
 insert into public.user_earnings(user_id,amount) values(s.referrer_id,125);
 end if;
 update public.tis_payment_sessions set user_id=p_user,status='completed',completed_at=now() where id=s.id;
end $$;

revoke all on function public.tis_checkout_create(text,text,text,text,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.tis_checkout_account(uuid) from public,anon,authenticated;
revoke all on function public.tis_checkout_finish(uuid,uuid) from public,anon,authenticated;
grant execute on function public.tis_checkout_create(text,text,text,text,text,uuid,text,text) to service_role;
grant execute on function public.tis_checkout_account(uuid) to service_role;
grant execute on function public.tis_checkout_finish(uuid,uuid) to service_role;
-- The old client-submitted UTR route is retired. Historical admin review remains available.
revoke execute on function public.tis_submit_enrollment(text,text,text,text) from public,anon,authenticated;
create or replace function tis_private.signup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,full_name,phone,referral_code,status)
 values(new.id,new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'phone',new.id::text,'pending') on conflict(id) do nothing;
 return new;
end $$;
-- Enforce payment-before-account even if a client bypasses the website's form.
create function tis_private.require_paid_signup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.tis_payment_sessions s where s.id::text=new.raw_user_meta_data->>'paid_checkout_id'
 and s.email=lower(trim(new.email)) and s.status='paid' and s.payment_id is not null and s.user_id is null) then
 raise exception 'Complete a verified course payment before creating an account'; end if;
 return new;
end $$;
revoke all on function tis_private.require_paid_signup() from public,anon,authenticated;
create trigger tis_require_paid_signup before insert on auth.users for each row execute function tis_private.require_paid_signup();
notify pgrst,'reload schema';
commit;
