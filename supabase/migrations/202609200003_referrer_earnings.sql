-- Follow-up to student_savings: earnings belong to the referring account.
-- The per-enrollment 70% snapshot is display-only; cashback remains separate.
begin;
create or replace function public.tis_earnings_summary() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'today',coalesce(sum(referral_saving) filter(where earned_at>=date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'),0),
 'week',coalesce(sum(referral_saving) filter(where earned_at>=now()-interval '7 days'),0),
 'month',coalesce(sum(referral_saving) filter(where earned_at>=now()-interval '30 days'),0),
 'all',coalesce(sum(referral_saving),0))
 from (select referral_saving,coalesce(approved_at,created_at) earned_at
 from public."Enrollments"
 where referrer_id=auth.uid() and user_id<>auth.uid()
 and lower(trim(status)) in ('approved','active')) earnings
 where earned_at<=now();
$$;
revoke all on function public.tis_earnings_summary() from public,anon;
grant execute on function public.tis_earnings_summary() to authenticated;
notify pgrst,'reload schema';
commit;
