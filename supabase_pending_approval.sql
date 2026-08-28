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
  add column if not exists payment_method text,
  add column if not exists payment_details jsonb default '{}'::jsonb,
  add column if not exists amount numeric default 0,
  add column if not exists status text default 'approved',
  add column if not exists progress integer default 0;

create unique index if not exists pending_users_email_pending_idx
  on public.pending_users (lower(email)) where status = 'pending';

alter table public.pending_users enable row level security;

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

-- The approval Edge Function uses the service role and performs the state change atomically.
revoke all on public.pending_users from anon, authenticated;
grant insert on public.pending_users to anon, authenticated;
grant select on public.pending_users to authenticated;
