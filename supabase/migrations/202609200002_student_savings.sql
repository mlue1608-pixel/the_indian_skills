-- Display-only student earnings. Never adds to the cashback/withdrawal ledger.
begin;
alter table public."Enrollments" add column referral_saving numeric(12,2);

create function tis_private.enrollment_saving(e public."Enrollments") returns numeric
language plpgsql stable security definer set search_path='' as $$
declare original numeric; saved numeric; details jsonb;
begin
 if lower(trim(e.status)) not in ('approved','active') or e.user_id is null
 or e.referrer_id is null or e.referrer_id=e.user_id then return 0; end if;
 if e.checkout_id is not null then
  select greatest(0,s.original_paise-s.amount_paise)/100.0 into saved
  from public.tis_payment_sessions s where s.id=e.checkout_id and (s.user_id is null or s.user_id=e.user_id)
  and lower(trim(s.email))=lower(trim(e.email))
  and s.referrer_id=e.referrer_id and s.status in ('paid','completed');
  return coalesce(saved,0);
 end if;
 -- Legacy installations store this column as text, sometimes plain UTR notes.
 -- Parse a local copy only; preserve the original column and its contents.
 begin
  details:=nullif(btrim(e.payment_details::text),'')::jsonb;
 exception when invalid_text_representation then
  details:=null;
 end;
 if coalesce(details->>'original_price','') ~ '^[0-9]+(\.[0-9]+)?$' then
  original:=(details->>'original_price')::numeric;
 else
  original:=tis_private.price(coalesce(nullif(trim(e.course_name),''),e.package_name));
 end if;
 -- Admin grants record zero collected payment; only the referral's 70% counts.
 return round(coalesce(original,0)*.70,2);
end $$;
revoke all on function tis_private.enrollment_saving(public."Enrollments") from public,anon,authenticated;

update public."Enrollments" e set referral_saving=tis_private.enrollment_saving(e)
where lower(trim(status)) in ('approved','active');

create function tis_private.snapshot_enrollment_saving() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' then
  if old.referral_saving is not null then
   new.referral_saving:=old.referral_saving;
   return new;
  end if;
 end if;
 new.referral_saving:=case when lower(trim(new.status)) in ('approved','active')
 then tis_private.enrollment_saving(new) else null end;
 return new;
end $$;
create trigger tis_snapshot_enrollment_saving before insert or update on public."Enrollments"
for each row execute function tis_private.snapshot_enrollment_saving();

create or replace function public.tis_earnings_summary() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'today',coalesce(sum(referral_saving) filter(where earned_at>=date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'),0),
 'week',coalesce(sum(referral_saving) filter(where earned_at>=now()-interval '7 days'),0),
 'month',coalesce(sum(referral_saving) filter(where earned_at>=now()-interval '30 days'),0),
 'all',coalesce(sum(referral_saving),0))
 from (select referral_saving,coalesce(approved_at,created_at) earned_at
 from public."Enrollments" where user_id=auth.uid() and lower(trim(status)) in ('approved','active')) savings
 where earned_at<=now();
$$;
revoke all on function public.tis_earnings_summary() from public,anon;
grant execute on function public.tis_earnings_summary() to authenticated;
notify pgrst,'reload schema';
commit;
