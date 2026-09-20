import {PGlite} from '../.local/pglite-test/package/dist/index.js';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const migration=await fs.readFile(new URL('../supabase/migrations/202609200002_student_savings.sql',import.meta.url),'utf8');
for(const type of ['text','jsonb']){
 const db=new PGlite();
 try{
  await db.exec(`create role anon; create role authenticated;
   create schema auth; create schema tis_private;
   create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
   create function tis_private.price(text) returns numeric language sql as $$select 2499::numeric$$;
   create table public."Enrollments"(id serial primary key,user_id uuid default auth.uid(),
    referrer_id uuid default '22222222-2222-4222-8222-222222222222',
    course_name text default 'Branding Management',package_name text,status text default 'approved',
    payment_details ${type},checkout_id uuid,email text,approved_at timestamptz default now(),created_at timestamptz default now());
   create table public.tis_payment_sessions(id uuid,user_id uuid,email text,referrer_id uuid,status text,original_paise integer,amount_paise integer);`);
  const cases=type==='text'
   ? ['{"original_price":1000}','UTR reference ABC123','',null,'{"broken":','null','{"original_price":"bad"}']
   : ['{"original_price":1000}','"UTR reference ABC123"',null,'null','{"original_price":"bad"}'];
  for(const value of cases)await db.query('insert into public."Enrollments"(payment_details) values($1)',[value]);
  await db.exec(migration);
  const rows=(await db.query('select payment_details::text details,referral_saving from public."Enrollments" order by id')).rows;
  assert.equal(Number(rows[0].referral_saving),700);
  rows.slice(1).forEach(row=>assert.equal(Number(row.referral_saving),1749.3));
  if(type==='text')assert.deepEqual(rows.map(row=>row.details),cases,'Legacy text is preserved');
  await db.query('insert into public."Enrollments"(payment_details) values($1)',['{"original_price":2000}']);
  assert.equal(Number((await db.query('select referral_saving from public."Enrollments" order by id desc limit 1')).rows[0].referral_saving),1400);
  await db.exec('truncate public."Enrollments"');
  for(const price of [2499,999,15000])await db.query('insert into public."Enrollments"(payment_details) values($1)',[JSON.stringify({original_price:price})]);
  const correction=await fs.readFile(new URL('../supabase/migrations/202609200003_referrer_earnings.sql',import.meta.url),'utf8');
  await db.exec(correction);await db.exec(correction);
  const summary=async()=> (await db.query('select public.tis_earnings_summary() data')).rows[0].data;
  assert.equal((await summary()).all,0,'Buyer does not receive their own discount as earnings');
  await db.exec(`create or replace function auth.uid() returns uuid language sql as $$select '22222222-2222-4222-8222-222222222222'::uuid$$`);
  assert.deepEqual(await summary(),{today:12948.6,week:12948.6,month:12948.6,all:12948.6},'Three referred courses count once for referrer');
  await db.exec(`update public."Enrollments" set approved_at=now()-interval '10 days'`);
  assert.deepEqual(await summary(),{today:0,week:0,month:12948.6,all:12948.6});
  await db.exec(`update public."Enrollments" set status='rejected'`);
  assert.equal((await summary()).all,0);
  await db.exec(`update public."Enrollments" set status='approved'`);
  assert.equal((await summary()).all,12948.6,'Reapproval does not duplicate earnings');
  await db.query('insert into public."Enrollments"(payment_details) values($1)',['{"original_price":2499}']);
  assert.equal((await summary()).all,12948.6,'Self referral excluded');
  await db.exec(`create table public.profiles(id uuid primary key,full_name text);
   insert into public.profiles values('22222222-2222-4222-8222-222222222222','Referrer');`);
  const leaderboardMigration=await fs.readFile(new URL('../supabase/migrations/202609200004_leaderboard_earnings.sql',import.meta.url),'utf8');
  await db.exec(leaderboardMigration);await db.exec(leaderboardMigration);
  const board=async period=>(await db.query('select * from public.tis_leaderboard($1)',[period])).rows;
  assert.equal((await board('all'))[0].student_name,'Referrer');
  assert.equal(Number((await board('all'))[0].total_earnings),(await summary()).all);
  assert.equal(Number((await board('month'))[0].total_earnings),12948.6);
  assert.equal((await board('today')).length,0);
  assert.equal((await board('week')).length,0);
  assert.equal((await board('invalid')).length,0);
  await db.query(`insert into public."Enrollments"(user_id,referrer_id,payment_details) values('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',$1)`,['{"original_price":20000}']);
  assert.equal((await board('all'))[0].student_name,'Platform User','Missing profile has safe fallback');
  assert.equal(Number((await board('all'))[0].total_earnings),14000,'Rank by course earnings descending');
  assert.equal(Number((await board('today'))[0].total_earnings),14000);
  await db.exec(`update public."Enrollments" set status='pending' where referrer_id='33333333-3333-4333-8333-333333333333'`);
  assert.equal((await board('all')).length,1,'Pending course excluded from ranking');
  await db.exec('set role anon');
  await assert.rejects(()=>board('all'),/permission denied/);
  await db.exec('reset role');
  console.log(`${type}: historical backfill, invalid/empty details fallback, preserved data and new approval passed`);
 }finally{await db.close();}
}
