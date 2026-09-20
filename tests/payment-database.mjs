// node tests/payment-database.mjs. Uses local PGlite package; no live database calls.
import {PGlite} from '../.local/pglite-test/package/dist/index.js';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
try{
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.email() returns text language sql as $$select email from auth.users where id=auth.uid()$$;`);
 for(const file of ['202609130001_tis_repair.sql','202609170001_referral_discount_70.sql'])await db.exec(await fs.readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.exec(await fs.readFile(new URL('./database_regression.sql',import.meta.url),'utf8'));
 const ref='11111111-1111-4111-8111-111111111111',student='22222222-2222-4222-8222-222222222222';
 await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,'ref@example.test',now())`,[ref]);
 await db.exec(await fs.readFile(new URL('../supabase/migrations/202609170002_razorpay_checkout.sql',import.meta.url),'utf8'));
 await db.exec(await fs.readFile(new URL('../supabase/migrations/202609190001_admin_signup_requests.sql',import.meta.url),'utf8'));
 await assert.rejects(()=>db.query(`insert into auth.users(id,email) values(gen_random_uuid(),'unpaid@example.test')`),/verified course payment/);
 const create=async(email,course='Marketing Management',referral=ref,user=null)=>{
  const result=await db.query(`select * from public.tis_checkout_create($1,'Student','9999999999',$2,$3,$4,'hash',$1)`,[email,course,referral,user]);return result.rows[0];
 };
 let s=await create('student@example.test');assert.equal(s.amount_paise,29970);assert.equal(s.original_paise,99900);
 assert.equal(new Date(s.expires_at)-new Date(s.created_at),360000);
 assert.equal((await db.query(`select count(*)::integer n from auth.users`)).rows[0].n,1,'No pre-payment account');
 await assert.rejects(()=>db.query('select public.tis_checkout_finish($1,$2)',[s.id,student]),/Verified captured payment required/);
 await assert.rejects(()=>create('student@example.test'),/already open/);
 await assert.rejects(()=>create('invalid@example.test','Marketing Management','invalid'),/Invalid referral/);
 await assert.rejects(()=>create('unknown@example.test','Unknown'),/Unknown course/);
 await assert.rejects(()=>create('ref@example.test'),/already registered/);
 await assert.rejects(()=>create('ref@example.test','Branding Management',ref,ref),/Invalid referral/);
 await db.query(`update public.tis_payment_sessions set status='paid',payment_id='pay_verified',order_id='order_verified' where id=$1`,[s.id]);
 await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'student@example.test',jsonb_build_object('paid_checkout_id',$2::text))`,[student,s.id]);
 await db.query('select public.tis_checkout_finish($1,$2)',[s.id,student]);
 await db.query('select public.tis_checkout_finish($1,$2)',[s.id,student]);
 const enrollments=(await db.query(`select * from public."Enrollments" where user_id=$1`,[student])).rows;
 assert.equal(enrollments.length,1);assert.equal(enrollments[0].status,'approved');assert.equal(Number(enrollments[0].amount),299.7);
 assert.equal(Number((await db.query('select balance from public.referral_cashback_wallet where user_id=$1',[ref])).rows[0].balance),125);
 await assert.rejects(()=>create('student@example.test','Marketing Management','',student),/already enrolled/);
 for(const [course,full,discounted] of [['Branding Management',249900,74970],['Traffic Management',500000,150000],['Influence Management',1000000,300000],['Finance Management',1500000,450000]]){
  assert.equal((await create(course.replaceAll(' ','')+'@example.test',course)).amount_paise,discounted);
  assert.equal((await create('full'+course.replaceAll(' ','')+'@example.test',course,'')).amount_paise,full);
 }
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  await assert.rejects(()=>db.query('select * from public.tis_payment_sessions'),/permission denied/);
  await assert.rejects(()=>db.query('select public.tis_checkout_finish($1,$2)',[s.id,student]),/permission denied/);
  await assert.rejects(()=>db.query("select public.tis_submit_enrollment('Marketing Management','UPI','fake','')"),/permission denied/);
  await db.exec('reset role');
 }
 console.log('Payment database checks passed: all course prices, 70% discount, six-minute expiry, no pre-payment account, duplicate prevention, approval/cashback idempotency and permissions. Legacy database checks also passed before the new migration.');
}finally{await db.close();}
