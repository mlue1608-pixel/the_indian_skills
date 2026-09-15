-- Apply in the configured project's SQL editor after reviewing a database backup.
-- Existing auth IDs and enrollment records are preserved. This migration is transactional.
begin;
create table if not exists public.profiles (id uuid primary key references auth.users(id));
alter table public.profiles
 add column if not exists full_name text,
 add column if not exists phone text,
 add column if not exists role text default 'student',
 add column if not exists status text default 'pending',
 add column if not exists referral_code text,
 add column if not exists referred_by uuid,
 add column if not exists created_at timestamptz default now();
do $$ begin
 if to_regclass('public."Enrollments"') is null and to_regclass('public.enrollments') is not null then
  alter table public.enrollments rename to "Enrollments";
 end if;
end $$;
create table if not exists public."Enrollments" (id uuid primary key default gen_random_uuid());
alter table public."Enrollments"
 add column if not exists user_id uuid,
 add column if not exists email text,
 add column if not exists full_name text,
 add column if not exists phone text,
 add column if not exists course_name text,
 add column if not exists package_name text,
 add column if not exists transaction_id text,
 add column if not exists status text default 'pending',
 add column if not exists payment_method text,
 add column if not exists payment_details jsonb default '{}',
 add column if not exists referrer_id uuid,
 add column if not exists referral_code text,
 add column if not exists amount numeric default 0,
 add column if not exists progress integer default 0,
 add column if not exists created_at timestamptz default now(),
 add column if not exists updated_at timestamptz default now(),
 add column if not exists approved_at timestamptz;
create table if not exists public.pending_users (
 id uuid primary key default gen_random_uuid(),full_name text,phone text,email text,
 package_name text,payment_method text,payment_details jsonb default '{}',
 referrer_id uuid,referral_code text,paid_price numeric default 0,
 status text default 'pending',approved_user_id uuid,created_at timestamptz default now(),approved_at timestamptz
);
create table if not exists public.user_earnings (
 id uuid primary key default gen_random_uuid(),user_id uuid,amount numeric default 0,created_at timestamptz default now()
);
alter table public.user_earnings add column if not exists amount numeric default 0,
 add column if not exists created_at timestamptz default now();
create table if not exists public.referral_cashback_wallet (
 id uuid primary key default gen_random_uuid(),user_id uuid not null unique references auth.users(id),
 balance numeric not null default 0,minimum_withdrawal numeric not null default 1000,
 created_at timestamptz default now(),updated_at timestamptz default now()
);
create table if not exists public.referral_cashback_transactions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 amount numeric not null,type text not null,source text not null,balance_after numeric not null,
 metadata jsonb default '{}',created_at timestamptz default now()
);
create table if not exists public.cashback_withdrawals (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 upi_id text not null,amount numeric not null,status text default 'pending',notes text,
 created_at timestamptz default now(),processed_at timestamptz
);
-- A dedicated ledger makes repeated or concurrent approvals idempotent.
create table if not exists public.tis_approval_credits (
 enrollment_id text primary key,referrer_id uuid not null,created_at timestamptz default now()
);
create schema if not exists tis_private;
revoke all on schema tis_private from public;
grant usage on schema tis_private to authenticated;
create or replace function tis_private.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null
 and (lower(u.email)='admin8controls@gmail.com' or exists(select 1 from public.profiles p where p.id=u.id and p.role='admin')));
$$;
create or replace function tis_private.price(p_course text) returns numeric
language sql immutable set search_path='' as $$
 select case lower(trim(p_course)) when 'marketing management' then 999 when 'branding management' then 2499
 when 'traffic management' then 5000 when 'influence management' then 10000 when 'finance management' then 15000 else null end::numeric;
$$;
create or replace function tis_private.referrer(p_code text) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare result uuid; matches integer;
begin
 if nullif(trim(p_code),'') is null then return null; end if;
 select count(*),min(u.id::text)::uuid into matches,result from auth.users u
 left join public.profiles p on p.id=u.id
 where u.email_confirmed_at is not null and (u.id::text=trim(p_code) or p.referral_code=trim(p_code));
 if matches<>1 then return null; end if;
 return result;
end $$;
create or replace function public.tis_resolve_referral(p_code text)
returns table(id uuid,referral_code text) language sql stable security definer set search_path='' as $$
 select r,r::text from (select tis_private.referrer(p_code) r) resolved where r is not null;
$$;
create or replace function public.tis_is_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select tis_private.is_admin();
$$;
create or replace function public.tis_my_enrollments() returns setof public."Enrollments"
language sql stable security definer set search_path='' as $$
 select e.* from public."Enrollments" e join auth.users u on u.id=auth.uid()
 where e.user_id=u.id or (e.user_id is null and u.email_confirmed_at is not null and lower(trim(e.email))=lower(u.email));
$$;
create or replace function public.tis_approval_status() returns text
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then return 'pending'; end if;
 if tis_private.is_admin() then return 'approved'; end if;
 if exists(select 1 from public.tis_my_enrollments() where lower(trim(status)) in ('approved','active')) then return 'approved'; end if;
 if exists(select 1 from public.tis_my_enrollments() where lower(trim(status))='pending') then return 'pending'; end if;
 if exists(select 1 from public.tis_my_enrollments() where lower(trim(status))='rejected') then return 'rejected'; end if;
 -- Legacy accounts without enrollment rows can sign in; this grants no PDF entitlement.
 if exists(select 1 from public.pending_users where lower(email)=lower(auth.email()) and status='pending') then return 'pending'; end if;
 return 'approved';
end $$;
create or replace function tis_private.submit(p_user uuid,p_course text,p_method text,p_transaction text,p_referral text)
returns void language plpgsql security definer set search_path='' as $$
declare price numeric; ref uuid; account auth.users; title text;
begin
 select * into strict account from auth.users where id=p_user;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 price:=tis_private.price(p_course);
 if price is null then raise exception 'Unknown course'; end if;
 if length(trim(coalesce(p_transaction,''))) not between 4 and 100 then raise exception 'A valid payment transaction ID / UTR is required'; end if;
 if p_method not in ('UPI','UPI ID','QR Code') then raise exception 'Invalid payment method'; end if;
 ref:=tis_private.referrer(p_referral);
 if nullif(trim(p_referral),'') is not null and (ref is null or ref=p_user) then raise exception 'Invalid referral link'; end if;
 if exists(select 1 from public."Enrollments" where (user_id=p_user or (user_id is null and lower(email)=lower(account.email)))
 and lower(trim(course_name))=lower(trim(p_course)) and lower(status) in ('approved','active','pending')) then raise exception 'This course is already enrolled or awaiting approval'; end if;
 title:=initcap(lower(trim(p_course)));
 insert into public."Enrollments"(user_id,email,full_name,phone,course_name,package_name,status,payment_method,transaction_id,amount,referrer_id,referral_code,payment_details)
 values(p_user,account.email,coalesce(account.raw_user_meta_data->>'full_name','Student'),account.raw_user_meta_data->>'phone',title,title,'pending',p_method,trim(p_transaction),
 case when ref is null then price else round(price*.25,2) end,ref,ref::text,jsonb_build_object('transaction_id',trim(p_transaction),'original_price',price));
end $$;
create or replace function public.tis_submit_enrollment(p_course text,p_method text,p_transaction text,p_referral text default '')
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 perform tis_private.submit(auth.uid(),p_course,p_method,p_transaction,p_referral);
end $$;
create or replace function tis_private.signup() returns trigger
language plpgsql security definer set search_path='' as $$
declare signup jsonb;
begin
 signup:=new.raw_user_meta_data->'tis_signup';
 insert into public.profiles(id,full_name,phone,referral_code,status)
 values(new.id,new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'phone',new.id::text,'pending') on conflict(id) do nothing;
 if signup is not null then
  perform tis_private.submit(new.id,signup->>'course',signup->>'method',signup->>'transaction',signup->>'referral');
 end if;
 return new;
end $$;
drop trigger if exists tis_signup_enrollment on auth.users;
create trigger tis_signup_enrollment after insert on auth.users for each row execute function tis_private.signup();
create or replace function public.tis_approve_enrollment(p_id text) returns void
language plpgsql security definer set search_path='' as $$
declare e public."Enrollments"; owner_id uuid; credited integer; new_balance numeric;
begin
 if not tis_private.is_admin() then raise exception 'Administrator access required'; end if;
 select * into strict e from public."Enrollments" where id::text=p_id for update;
 if lower(e.status) in ('approved','active') then return; end if;
 if lower(e.status)<>'pending' then raise exception 'Only pending enrollments can be approved'; end if;
 owner_id:=e.user_id;
 if owner_id is null then select id into owner_id from auth.users where lower(email)=lower(trim(e.email)) and email_confirmed_at is not null; end if;
 if owner_id is null then raise exception 'No verified Auth account exists for this enrollment; invite the student first'; end if;
 update public."Enrollments" set user_id=owner_id,status='approved',approved_at=now(),updated_at=now() where id=e.id;
 insert into public.profiles(id,full_name,status,referred_by,referral_code) values(owner_id,e.full_name,'active',e.referrer_id,owner_id::text)
 on conflict(id) do update set status='active',referred_by=coalesce(public.profiles.referred_by,excluded.referred_by);
 if e.referrer_id is not null and e.referrer_id<>owner_id then
  insert into public.tis_approval_credits(enrollment_id,referrer_id) values(e.id::text,e.referrer_id) on conflict do nothing;
  get diagnostics credited=row_count;
  if credited=1 then
   insert into public.referral_cashback_wallet(user_id,balance) values(e.referrer_id,125)
   on conflict(user_id) do update set balance=public.referral_cashback_wallet.balance+125,updated_at=now() returning balance into new_balance;
   insert into public.referral_cashback_transactions(user_id,amount,type,source,balance_after,metadata)
   values(e.referrer_id,125,'credit','approved_referral_purchase',new_balance,jsonb_build_object('enrollment_id',e.id));
   insert into public.user_earnings(user_id,amount) values(e.referrer_id,125);
  end if;
 end if;
end $$;
create or replace function public.tis_withdraw_cashback(p_upi text) returns uuid
language plpgsql security definer set search_path='' as $$
declare wallet public.referral_cashback_wallet; withdrawal uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if coalesce(p_upi,'') !~ '^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$' then raise exception 'Invalid UPI ID'; end if;
 select * into wallet from public.referral_cashback_wallet where user_id=auth.uid() for update;
 if wallet.user_id is null or wallet.balance<greatest(1000,wallet.minimum_withdrawal) then raise exception 'Minimum ₹1000 required to withdraw'; end if;
 insert into public.cashback_withdrawals(user_id,upi_id,amount,status) values(auth.uid(),p_upi,wallet.balance,'pending') returning id into withdrawal;
 update public.referral_cashback_wallet set balance=0,updated_at=now() where user_id=auth.uid();
 insert into public.referral_cashback_transactions(user_id,amount,type,source,balance_after,metadata)
 values(auth.uid(),wallet.balance,'debit','cashback_withdrawal',0,jsonb_build_object('withdrawal_id',withdrawal));
 return withdrawal;
end $$;
create or replace function public.tis_approve_legacy(p_id text,p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare pending public.pending_users; enrollment_id text;
begin
 if not tis_private.is_admin() then raise exception 'Administrator access required'; end if;
 select * into strict pending from public.pending_users where id::text=p_id for update;
 if pending.status='approved' then return; end if;
 if pending.status<>'pending' then raise exception 'Signup is not pending'; end if;
 if not exists(select 1 from auth.users where id=p_user and lower(email)=lower(pending.email)) then raise exception 'Auth account does not match signup'; end if;
 insert into public."Enrollments"(user_id,email,full_name,phone,course_name,package_name,payment_method,payment_details,amount,referrer_id,status)
 values(p_user,pending.email,pending.full_name,pending.phone,pending.package_name,pending.package_name,pending.payment_method,pending.payment_details,
 coalesce(nullif(pending.paid_price,0),(to_jsonb(pending)->>'referral_discount_price')::numeric,0),pending.referrer_id,'pending') returning id::text into enrollment_id;
 perform public.tis_approve_enrollment(enrollment_id);
 update public.pending_users set status='approved',approved_user_id=p_user,approved_at=now() where id=pending.id;
end $$;
create or replace function public.tis_earnings_summary() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('today',coalesce(sum(amount) filter(where created_at>=date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'),0),
 'week',coalesce(sum(amount) filter(where created_at>=now()-interval '7 days'),0),
 'month',coalesce(sum(amount) filter(where created_at>=now()-interval '30 days'),0),'all',coalesce(sum(amount),0))
 from public.user_earnings where user_id=auth.uid() and created_at<=now();
$$;
create or replace function public.tis_leaderboard(p_period text) returns table(student_name text,total_earnings numeric)
language sql stable security definer set search_path='' as $$
 select coalesce(p.full_name,'Platform User'),sum(e.amount)::numeric from public.user_earnings e left join public.profiles p on p.id=e.user_id
 where auth.uid() is not null and e.created_at<=now() and e.created_at>=case p_period
 when 'today' then date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
 when 'week' then now()-interval '7 days' when 'month' then now()-interval '30 days' when 'all' then '-infinity'::timestamptz else 'infinity'::timestamptz end
 group by e.user_id,p.full_name order by sum(e.amount) desc limit 100;
$$;
create or replace function public.tis_team() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('profile',jsonb_build_object('id',p.id,'full_name',p.full_name,'phone',p.phone,'referral_code',p.id,'status',p.status,'created_at',p.created_at),
 'enrollment',coalesce(to_jsonb(e),'{}'::jsonb))),'[]'::jsonb)
 from public.profiles p left join lateral(select course_name,status,created_at,email from public."Enrollments" where user_id=p.id order by created_at desc limit 1) e on true
 where p.referred_by=auth.uid() and auth.uid() is not null;
$$;
create or replace function public.tis_admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare records jsonb; pending jsonb; students bigint; revenue numeric; total bigint;
begin
 if not tis_private.is_admin() then raise exception 'Administrator access required'; end if;
 select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('profile',coalesce(to_jsonb(p),'{}'::jsonb)) order by e.created_at desc),'[]'::jsonb)
 into records from public."Enrollments" e left join public.profiles p on p.id=e.user_id;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc),'[]'::jsonb) into pending from public.pending_users p where lower(status)='pending';
 select count(*) into students from auth.users u where lower(u.email)<>'admin8controls@gmail.com' and not exists(select 1 from public.profiles p where p.id=u.id and p.role='admin');
 select count(*),coalesce(sum(amount) filter(where lower(trim(status)) in ('approved','active')),0) into total,revenue from public."Enrollments";
 return jsonb_build_object('enrollments',records,'pending',pending,'totalStudents',students,'totalEnrollments',total,'totalRevenue',revenue);
end $$;
create or replace function public.tis_update_profile(p_name text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or length(trim(p_name)) not between 2 and 60 then raise exception 'A valid profile name is required'; end if;
 insert into public.profiles(id,full_name,referral_code) values(auth.uid(),trim(p_name),auth.uid()::text)
 on conflict(id) do update set full_name=excluded.full_name;
end $$;
-- Replace the app tables' policies: old permissive policies would otherwise bypass these checks.
do $$ declare t text; policy record; begin
 foreach t in array array['profiles','Enrollments','pending_users','user_earnings','referral_cashback_wallet','referral_cashback_transactions','cashback_withdrawals','tis_approval_credits'] loop
  execute format('alter table public.%I enable row level security',t);
  for policy in select policyname from pg_policies where schemaname='public' and tablename=t loop
   execute format('drop policy %I on public.%I',policy.policyname,t);
  end loop;
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage on schema public to anon,authenticated;
grant select on public.profiles,public."Enrollments",public.pending_users,public.user_earnings,public.referral_cashback_wallet,public.referral_cashback_transactions,public.cashback_withdrawals to authenticated;
create policy tis_profiles_read on public.profiles for select to authenticated using(id=auth.uid() or tis_private.is_admin());
create policy tis_enrollments_read on public."Enrollments" for select to authenticated using(user_id=auth.uid() or tis_private.is_admin());
create policy tis_pending_read on public.pending_users for select to authenticated using(tis_private.is_admin());
create policy tis_earnings_read on public.user_earnings for select to authenticated using(user_id=auth.uid() or tis_private.is_admin());
create policy tis_wallet_read on public.referral_cashback_wallet for select to authenticated using(user_id=auth.uid() or tis_private.is_admin());
create policy tis_transactions_read on public.referral_cashback_transactions for select to authenticated using(user_id=auth.uid() or tis_private.is_admin());
create policy tis_withdrawals_read on public.cashback_withdrawals for select to authenticated using(user_id=auth.uid() or tis_private.is_admin());
revoke all on all functions in schema tis_private from public,anon,authenticated;
grant execute on function tis_private.is_admin() to authenticated;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tis\_%' escape '\' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to authenticated,service_role',f.signature);
 end loop;
end $$;
grant execute on function public.tis_resolve_referral(text) to anon;
notify pgrst,'reload schema';
commit;
