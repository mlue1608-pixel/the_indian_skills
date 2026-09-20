-- Apply after 202609130001_tis_repair.sql. Existing enrollment amounts are preserved.
BEGIN;
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
 case when ref is null then price else round(price*.30,2) end,ref,ref::text,jsonb_build_object('transaction_id',trim(p_transaction),'original_price',price));
end $$;
COMMIT;
