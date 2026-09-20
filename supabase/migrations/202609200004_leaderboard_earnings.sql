-- Run after 202609200003_referrer_earnings.sql.
-- Rank the same approved referral earnings shown on the student dashboard.
begin;
create or replace function public.tis_leaderboard(p_period text)
returns table(student_name text,total_earnings numeric)
language sql stable security definer set search_path='' as $$
 select coalesce(nullif(trim(p.full_name),''),'Platform User'),sum(e.referral_saving)::numeric
 from public."Enrollments" e
 left join public.profiles p on p.id=e.referrer_id
 where auth.uid() is not null
 and e.referrer_id is not null and e.user_id<>e.referrer_id
 and lower(trim(e.status)) in ('approved','active')
 and coalesce(e.approved_at,e.created_at)<=now()
 and coalesce(e.approved_at,e.created_at)>=case p_period
 when 'today' then date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
 when 'week' then now()-interval '7 days'
 when 'month' then now()-interval '30 days'
 when 'all' then '-infinity'::timestamptz
 else 'infinity'::timestamptz end
 group by e.referrer_id,p.full_name
 having sum(e.referral_saving)>0
 order by sum(e.referral_saving) desc,e.referrer_id
 limit 100;
$$;
revoke all on function public.tis_leaderboard(text) from public,anon;
grant execute on function public.tis_leaderboard(text) to authenticated;
notify pgrst,'reload schema';
commit;
