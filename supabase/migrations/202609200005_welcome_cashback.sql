-- One welcome credit per approved student, including existing approved students.
begin;
create table if not exists tis_private.welcome_cashback_credits (
 user_id uuid primary key references auth.users(id),
 amount numeric not null default 125 check(amount=125),
 created_at timestamptz not null default now()
);
revoke all on tis_private.welcome_cashback_credits from public,anon,authenticated,service_role;

create or replace function tis_private.credit_welcome_cashback(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare inserted integer; new_balance numeric;
begin
 if p_user is null or not exists(select 1 from auth.users where id=p_user) then return; end if;
 if exists(select 1 from public.profiles where id=p_user and role='admin')
 or exists(select 1 from auth.users where id=p_user and lower(email)='admin8controls@gmail.com') then return; end if;
 if not exists(select 1 from public."Enrollments" where user_id=p_user and lower(trim(status)) in ('approved','active'))
 and not exists(select 1 from public.profiles where id=p_user and lower(trim(status)) in ('approved','active')) then return; end if;
 insert into tis_private.welcome_cashback_credits(user_id) values(p_user) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted=0 then return; end if;
 insert into public.referral_cashback_wallet(user_id,balance) values(p_user,125)
 on conflict(user_id) do update set balance=public.referral_cashback_wallet.balance+125,updated_at=now()
 returning balance into new_balance;
 insert into public.referral_cashback_transactions(user_id,amount,type,source,balance_after,metadata)
 values(p_user,125,'credit','welcome_cashback',new_balance,jsonb_build_object('welcome_user_id',p_user));
end $$;
revoke all on function tis_private.credit_welcome_cashback(uuid) from public,anon,authenticated,service_role;

create or replace function tis_private.welcome_on_approval() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if lower(trim(new.status)) in ('approved','active') then
  perform tis_private.credit_welcome_cashback(new.user_id);
 end if;
 return new;
end $$;
drop trigger if exists tis_welcome_on_approval on public."Enrollments";
create trigger tis_welcome_on_approval after insert or update on public."Enrollments"
for each row execute function tis_private.welcome_on_approval();

-- The same ledger makes rerunning deployment and approval retries harmless.
do $$ declare student record;
begin
 for student in
  select user_id from public."Enrollments" where lower(trim(status)) in ('approved','active') and user_id is not null
  union select id from public.profiles where lower(trim(status)) in ('approved','active')
 loop perform tis_private.credit_welcome_cashback(student.user_id); end loop;
end $$;
notify pgrst,'reload schema';
commit;
