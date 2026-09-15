-- Run only on a staging Supabase project after the migration. No email is sent.
-- All fixtures and state changes are rolled back. If a statement fails, ROLLBACK.
begin;
create temporary table tis_test_ids(student uuid,referrer uuid,admin uuid,enrollment text);
insert into tis_test_ids values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null);
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select student,student::text||'@example.invalid',now(),'{}'::jsonb from tis_test_ids
union all select referrer,referrer::text||'@example.invalid',now(),'{}'::jsonb from tis_test_ids
union all select admin,admin::text||'@example.invalid',now(),'{}'::jsonb from tis_test_ids;
update public.profiles set role='admin' where id=(select admin from tis_test_ids);
select set_config('request.jwt.claims',jsonb_build_object('sub',student,'role','authenticated')::text,true) from tis_test_ids;
select public.tis_submit_enrollment('Marketing Management','UPI','TEST-UTR-001',referrer::text) from tis_test_ids;
update tis_test_ids set enrollment=(select id::text from public."Enrollments" where user_id=tis_test_ids.student limit 1);
do $$ begin
 if public.tis_approval_status()<>'pending' then raise exception 'New signup must await approval'; end if;
 if (select amount from public."Enrollments" where id::text=(select enrollment from tis_test_ids))<>249.75 then raise exception '75%% discount is incorrect'; end if;
 begin
  perform public.tis_approve_enrollment((select enrollment from tis_test_ids));
  raise exception 'Student approval was allowed';
 exception when raise_exception then
  if sqlerrm<>'Administrator access required' then raise; end if;
 end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated')::text,true) from tis_test_ids;
select public.tis_approve_enrollment(enrollment) from tis_test_ids;
select public.tis_approve_enrollment(enrollment) from tis_test_ids;
do $$ begin
 if (select balance from public.referral_cashback_wallet where user_id=(select referrer from tis_test_ids))<>125 then raise exception 'Approval must credit exactly once'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',student,'role','authenticated')::text,true) from tis_test_ids;
select public.tis_submit_enrollment('Branding Management','UPI','TEST-UTR-002','');
do $$ begin
 if public.tis_approval_status()<>'approved' then raise exception 'Pending upgrade must not lock existing courses'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',referrer,'role','authenticated')::text,true) from tis_test_ids;
do $$ begin
 begin
  perform public.tis_withdraw_cashback('student@upi');
  raise exception 'Below-minimum withdrawal was allowed';
 exception when raise_exception then
  if sqlerrm<>'Minimum ₹1000 required to withdraw' then raise; end if;
 end;
end $$;
update public.referral_cashback_wallet set balance=1000 where user_id=(select referrer from tis_test_ids);
select public.tis_withdraw_cashback('student@upi');
do $$ begin
 if (select balance from public.referral_cashback_wallet where user_id=(select referrer from tis_test_ids))<>0 then raise exception 'Withdrawal did not reserve funds'; end if;
 if (select count(*) from public.cashback_withdrawals where user_id=(select referrer from tis_test_ids))<>1 then raise exception 'Unexpected withdrawal count'; end if;
end $$;
set local role authenticated;
do $$ begin
 begin
  update public.referral_cashback_wallet set balance=999999 where user_id=auth.uid();
  raise exception 'Direct wallet edits were allowed';
 exception when insufficient_privilege then null;
 end;
 begin
  update public."Enrollments" set status='approved' where user_id=auth.uid();
  raise exception 'Direct enrollment approval was allowed';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
rollback;
