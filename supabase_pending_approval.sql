create table if not exists public.pending_users (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  email text not null,
  referral_code text,
  referrer_id uuid references public.profiles(id) on delete set null,
  package_name text not null,
  payment_method text not null,
  utr_number text,
  payment_details jsonb not null default '{}'::jsonb,
  original_price numeric not null default 0,
  discount_amount numeric not null default 0,
  paid_price numeric not null default 0,
  referral_discount_price numeric not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

alter table if exists public.pending_users
  add column if not exists utr_number text,
  add column if not exists paid_price numeric not null default 0;

alter table if exists public."Enrollments"
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists email text,
  add column if not exists full_name text,
  add column if not exists phone text,
  add column if not exists course_name text,
  add column if not exists package_name text,
  add column if not exists transaction_id text,
  add column if not exists status text default 'pending',
  add column if not exists payment_method text,
  add column if not exists payment_details jsonb default '{}'::jsonb,
  add column if not exists referrer_id uuid references public.profiles(id) on delete set null,
  add column if not exists referral_code text,
  add column if not exists amount numeric default 0,
  add column if not exists progress integer default 0,
  add column if not exists updated_at timestamptz default now(),
  add column if not exists approved_at timestamptz;

create unique index if not exists pending_users_email_pending_idx
  on public.pending_users (lower(email)) where status = 'pending';

create table if not exists public.referral_cashback_wallet (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  balance numeric not null default 0,
  minimum_withdrawal numeric not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.referral_cashback_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null default 0,
  type text not null check (type in ('credit', 'debit')),
  source text not null default 'referral',
  balance_after numeric not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.cashback_withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  upi_id text not null,
  amount numeric not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  notes text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.referral_cashback_wallet enable row level security;
alter table public.referral_cashback_transactions enable row level security;
alter table public.cashback_withdrawals enable row level security;

drop policy if exists "Users can manage their cashback wallet" on public.referral_cashback_wallet;
create policy "Users can manage their cashback wallet"
on public.referral_cashback_wallet for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can view their cashback entries" on public.referral_cashback_transactions;
create policy "Users can view their cashback entries"
on public.referral_cashback_transactions for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert cashback entries" on public.referral_cashback_transactions;
create policy "Users can insert cashback entries"
on public.referral_cashback_transactions for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can manage their withdrawals" on public.cashback_withdrawals;
create policy "Users can manage their withdrawals"
on public.cashback_withdrawals for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update, delete on public.referral_cashback_wallet to authenticated;
grant select, insert on public.referral_cashback_transactions to authenticated;
grant select, insert, update on public.cashback_withdrawals to authenticated;

alter table public.pending_users enable row level security;
alter table public."Enrollments" enable row level security;

-- Keep owner access explicit and consistent with supabase_enrollment_access.sql.
grant usage on schema public to authenticated;
drop policy if exists "Enrollment owners can select" on public."Enrollments";
create policy "Enrollment owners can select"
on public."Enrollments" for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Anyone can submit pending signup" on public.pending_users;
create policy "Anyone can submit pending signup"
  on public.pending_users for insert
  with check (status = 'pending' and approved_user_id is null);

drop policy if exists "Admins can view pending signups" on public.pending_users;
create policy "Admins can view pending signups"
  on public.pending_users for select
  using (
    auth.jwt() ->> 'email' = 'admin8controls@gmail.com'
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- Enrollments must allow the public signup flow to create a pending record before admin review.
drop policy if exists "Enrollments pending signup insert" on public."Enrollments";
create policy "Enrollments pending signup insert"
on public."Enrollments" for insert
with check (
  status = 'pending'
  and email is not null
  and course_name is not null
  and (
    auth.uid() = user_id
    or auth.uid() is null
  )
);

drop policy if exists "Users can view their own enrollments" on public."Enrollments";
create policy "Users can view their own enrollments"
on public."Enrollments" for select
using (
  auth.uid() = user_id
  or email = auth.email()
  or auth.jwt() ->> 'email' = 'admin8controls@gmail.com'
  or exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role = 'admin'
  )
);

drop policy if exists "Users can update their own enrollments" on public."Enrollments";
create policy "Users can update their own enrollments"
on public."Enrollments" for update
using (
  auth.uid() = user_id
  or email = auth.email()
  or auth.jwt() ->> 'email' = 'admin8controls@gmail.com'
)
with check (
  auth.uid() = user_id
  or email = auth.email()
  or auth.jwt() ->> 'email' = 'admin8controls@gmail.com'
);

-- The approval Edge Function uses the service role and performs the state change atomically.
revoke all on public.pending_users from anon, authenticated;
grant insert on public.pending_users to anon, authenticated;
grant select on public.pending_users to authenticated;
revoke all on public."Enrollments" from anon, authenticated;
grant insert on public."Enrollments" to anon, authenticated;
grant select, update on public."Enrollments" to authenticated;
