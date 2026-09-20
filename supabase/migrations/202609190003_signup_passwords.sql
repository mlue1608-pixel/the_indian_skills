-- New signups choose a password before payment/admin approval.
-- Only bcrypt hashes persist, in a private table. Auth accounts still wait.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table tis_private.signup_passwords (
 kind text not null check(kind in ('pending','checkout')),
 request_id uuid not null,
 password_hash text not null,
 created_at timestamptz not null default now(),
 primary key(kind,request_id)
);
revoke all on tis_private.signup_passwords from public,anon,authenticated,service_role;

create function tis_private.hash_signup_password(p_password text) returns text
language plpgsql security definer set search_path='' as $$
declare crypto_schema text; result text;
begin
 if p_password is null or length(p_password)<6 or octet_length(p_password)>72 then
 raise exception 'Password must be at least 6 characters and at most 72 UTF-8 bytes'; end if;
 select n.nspname into strict crypto_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';
 execute format('select %I.crypt($1,%I.gen_salt(''bf'',12))',crypto_schema,crypto_schema) into result using p_password;
 return result;
end $$;
revoke all on function tis_private.hash_signup_password(text) from public,anon,authenticated,service_role;

create function public.tis_request_signup_with_password(p_email text,p_name text,p_phone text,p_course text,p_referral text,p_ip text,p_password text)
returns void language plpgsql security definer set search_path='' as $$
declare existed boolean; request_id uuid;
begin
 p_email:=lower(trim(p_email));
 perform pg_advisory_xact_lock(hashtextextended(p_email,17));
 select exists(select 1 from public.pending_users where lower(trim(email))=p_email and status='pending')
 or exists(select 1 from auth.users where lower(email)=p_email) into existed;
 perform public.tis_request_signup(p_email,p_name,p_phone,p_course,p_referral,p_ip);
 -- Never let a repeated unauthenticated request replace an account/password.
 if existed then return; end if;
 select id into strict request_id from public.pending_users where email=p_email and status='pending';
 insert into tis_private.signup_passwords(kind,request_id,password_hash)
 values('pending',request_id,tis_private.hash_signup_password(p_password));
end $$;

create function public.tis_checkout_create_with_password(p_email text,p_name text,p_phone text,p_course text,p_referral text,p_user uuid,p_hash text,p_ip text,p_password text)
returns public.tis_payment_sessions language plpgsql security definer set search_path='' as $$
declare s public.tis_payment_sessions;
begin
 s:=public.tis_checkout_create(p_email,p_name,p_phone,p_course,p_referral,p_user,p_hash,p_ip);
 if p_user is null then
 insert into tis_private.signup_passwords(kind,request_id,password_hash)
 values('checkout',s.id,tis_private.hash_signup_password(p_password));
 end if;
 return s;
end $$;

create function public.tis_signup_password(p_kind text,p_id uuid) returns text
language sql security definer set search_path='' as $$
 select c.password_hash from tis_private.signup_passwords c where c.kind=p_kind and c.request_id=p_id
 and ((p_kind='pending' and exists(select 1 from public.pending_users p join tis_private.signup_approvals a on a.pending_id=p.id where p.id=p_id and p.status='pending'))
 or (p_kind='checkout' and exists(select 1 from public.tis_payment_sessions s where s.id=p_id and s.status='paid' and s.payment_id is not null)));
$$;
revoke all on function public.tis_request_signup_with_password(text,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.tis_checkout_create_with_password(text,text,text,text,text,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.tis_signup_password(text,uuid) from public,anon,authenticated;
grant execute on function public.tis_request_signup_with_password(text,text,text,text,text,text,text) to service_role;
grant execute on function public.tis_checkout_create_with_password(text,text,text,text,text,uuid,text,text,text) to service_role;
grant execute on function public.tis_signup_password(text,uuid) to service_role;

create function tis_private.clear_signup_password() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='pending_users' and new.status in ('approved','rejected') then
 delete from tis_private.signup_passwords where kind='pending' and request_id=new.id;
 elsif tg_table_name='tis_payment_sessions' and new.status in ('completed','refund_required') then
 delete from tis_private.signup_passwords where kind='checkout' and request_id=new.id;
 end if;
 return new;
end $$;
revoke all on function tis_private.clear_signup_password() from public,anon,authenticated,service_role;
create trigger tis_pending_password_cleanup after update of status on public.pending_users
for each row execute function tis_private.clear_signup_password();
create trigger tis_checkout_password_cleanup after update of status on public.tis_payment_sessions
for each row execute function tis_private.clear_signup_password();
notify pgrst,'reload schema';
commit;
