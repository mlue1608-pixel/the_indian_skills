-- Separate QR validity from Payment Link validity. Existing sessions keep their expiry.
begin;
alter table public.tis_payment_sessions add column checkout_method text not null default 'QR Code'
 check(checkout_method in ('QR Code','Payment Link'));
create or replace function public.tis_checkout_create(p_email text,p_name text,p_phone text,p_course text,p_referral text,p_user uuid,p_hash text,p_ip text)
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
 (status='paid' or (status='created' and expires_at>now()))) then raise exception 'A payment session is already open. Use Resume / check last payment, or wait until that session expires.'; end if;
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


create function public.tis_checkout_create_for_method(p_email text,p_name text,p_phone text,p_course text,p_referral text,p_user uuid,p_hash text,p_ip text,p_password text,p_method text)
returns public.tis_payment_sessions language plpgsql security definer set search_path='' as $$
declare s public.tis_payment_sessions;
begin
 if p_method is null or p_method not in ('QR Code','Payment Link') then raise exception 'Invalid checkout method'; end if;
 s:=public.tis_checkout_create_with_password(p_email,p_name,p_phone,p_course,p_referral,p_user,p_hash,p_ip,p_password);
 update public.tis_payment_sessions set checkout_method=p_method,
 expires_at=created_at+case when p_method='QR Code' then interval '6 minutes' else interval '24 hours' end
 where id=s.id returning * into s;
 return s;
end $$;
revoke all on function public.tis_checkout_create_for_method(text,text,text,text,text,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.tis_checkout_create_for_method(text,text,text,text,text,uuid,text,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
