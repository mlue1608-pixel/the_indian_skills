// node tests/all-auth-photo-repair.mjs — disposable PostgreSQL, no live data.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); }
catch { ({ PGlite } = await import('../.local/pglite-test/package/dist/index.js')); }
const read = name => fs.readFile(new URL('../' + name, import.meta.url), 'utf8');
const migration = await read('supabase/migrations/202609140001_auth_photo_tokens.sql');
const verification = await read('scripts/verify-all-auth-photos.sql');
const db = await PGlite.create();
const passed = [];
const test = async (name, fn) => { await fn(); passed.push(name); };
const ids = [1, 2, 3, 4, 5].map(n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0'));
const photo = 'data:image/png;base64,' + 'a'.repeat(99000);
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz,
      raw_user_meta_data jsonb, raw_app_meta_data jsonb default '{"role":"authenticated"}',
      encrypted_password text default 'password-fixture', created_at timestamptz default now(), updated_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create function auth.email() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email' $$;
    grant usage on schema auth to authenticated, supabase_auth_admin;
    grant insert,update,select on auth.users to supabase_auth_admin;
  `);
  await db.exec(await read('supabase/migrations/202609130001_tis_repair.sql'));
  for (const [i, metadata] of [
    { full_name: 'Admin Fixture', avatar: photo },
    { full_name: 'Student Fixture', profile_picture: photo, picture: photo, preferences: { dark: true } },
    { full_name: 'Clean Fixture', avatar_url: 'https://example.test/photo.jpg' }
  ].entries()) await db.query('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ($1,$2,now(),$3)', [ids[i], `user${i}@example.test`, metadata]);
  await db.query("update public.profiles set role='admin' where id=$1", [ids[0]]);
  await db.query(`insert into public."Enrollments"(user_id,email,course_name,status,amount) values ($1,'user1@example.test','Marketing Management','approved',999)`, [ids[1]]);
  const preserved = async () => ({
    accounts: (await db.query('select id,email,encrypted_password,raw_app_meta_data,email_confirmed_at from auth.users order by id')).rows,
    profiles: (await db.query('select * from public.profiles order by id')).rows,
    enrollments: (await db.query('select * from public."Enrollments" order by id')).rows
  });
  const before = await preserved();
  await test('All affected accounts are cleaned while accounts, roles and enrollment approvals are preserved', async () => {
    await db.exec(migration);
    assert.deepEqual(await preserved(), before);
    const report = (await db.query(verification)).rows;
    assert.equal(report.length, 3);
    assert.ok(report.every(row => row.result.startsWith('OK:') && row.future_photo_protection && row.metadata_bytes < 1000));
    assert.equal((await db.query('select count(*)::int as n from tis_auth_repair_archive.profile_photos')).rows[0].n, 2);
    assert.equal((await db.query('select raw_user_meta_data from auth.users where id=$1', [ids[2]])).rows[0].raw_user_meta_data.avatar_url, 'https://example.test/photo.jpg');
  });
  await test('New signup from the Auth role strips embedded photos and preserves the real pending enrollment trigger', async () => {
    await db.exec('set role supabase_auth_admin');
    try { await db.query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)', [ids[3], 'new@example.test', {
      full_name: 'New Student', phone: '9999999999', avatar: photo,
      tis_signup: { course: 'Marketing Management', method: 'UPI', transaction: 'TEST-NEW-001', referral: '' }
    }]); } finally { await db.exec('reset role'); }
    const metadata = (await db.query('select raw_user_meta_data from auth.users where id=$1', [ids[3]])).rows[0].raw_user_meta_data;
    assert.equal(metadata.avatar, undefined);
    assert.equal(metadata.tis_signup.transaction, 'TEST-NEW-001');
    const enrollment = (await db.query('select status,amount from public."Enrollments" where user_id=$1', [ids[3]])).rows[0];
    assert.equal(enrollment.status, 'pending'); assert.equal(Number(enrollment.amount), 999);
  });
  await test('Old clients cannot put image data back into Auth metadata on profile updates', async () => {
    await db.exec('set role supabase_auth_admin');
    try { await db.query('update auth.users set raw_user_meta_data=raw_user_meta_data || $1::jsonb where id=$2', [{ avatar_url: photo, full_name: 'Updated Student' }, ids[1]]); }
    finally { await db.exec('reset role'); }
    const metadata = (await db.query('select raw_user_meta_data from auth.users where id=$1', [ids[1]])).rows[0].raw_user_meta_data;
    assert.equal(metadata.avatar_url, undefined); assert.equal(metadata.full_name, 'Updated Student');
    assert.deepEqual(metadata.preferences, { dark: true });
  });
  await test('Migration reruns do not duplicate existing archives or recreate accounts', async () => {
    const count = (await db.query('select count(*)::int as n from tis_auth_repair_archive.profile_photos')).rows[0].n;
    const snapshot = await preserved();
    await db.exec(migration);
    assert.equal((await db.query('select count(*)::int as n from tis_auth_repair_archive.profile_photos')).rows[0].n, count);
    assert.deepEqual(await preserved(), snapshot);
  });
  await test('Archive data and the trigger function are inaccessible to browser roles', async () => {
    for (const role of ['anon','authenticated']) {
      const result = (await db.query(`select has_schema_privilege($1,'tis_auth_repair_archive','USAGE') as s,
        has_table_privilege($1,'tis_auth_repair_archive.profile_photos','SELECT') as t,
        has_function_privilege($1,'tis_auth_repair_archive.remove_embedded_photos()','EXECUTE') as f`, [role])).rows[0];
      assert.deepEqual(result, { s: false, t: false, f: false });
    }
  });
  await test('Existing database authorization and payment regressions still pass with the protection enabled', async () => {
    await db.exec(await read('tests/database_regression.sql'));
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: ids[0], role: 'authenticated' })]);
    assert.equal((await db.query('select public.tis_is_admin() as is_admin')).rows[0].is_admin, true);
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: ids[1], role: 'authenticated' })]);
    assert.equal((await db.query('select public.tis_approval_status() as status')).rows[0].status, 'approved');
  });
  await test('Large non-photo fields are preserved and explicitly flagged for review', async () => {
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)', [ids[4], 'review@example.test', { notes: 'x'.repeat(9000), picture: photo }]);
    const report = (await db.query(verification)).rows.find(row => row.email === 'review@example.test');
    assert.match(report.result, /NEEDS REVIEW/);
    assert.equal((await db.query('select raw_user_meta_data from auth.users where id=$1', [ids[4]])).rows[0].raw_user_meta_data.notes.length, 9000);
  });
  await test('Rejected signup rolls back the account, enrollment and archived image together', async () => {
    const count = (await db.query('select count(*)::int as n from tis_auth_repair_archive.profile_photos')).rows[0].n;
    const rejectedId = '00000000-0000-4000-8000-000000000006';
    await assert.rejects(db.query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)', [rejectedId, 'rejected@example.test', {
      avatar: photo, tis_signup: { course: 'Invalid Course', method: 'UPI', transaction: 'TEST-REJECTED' }
    }]), /Unknown course/);
    assert.equal((await db.query('select count(*)::int as n from auth.users where id=$1', [rejectedId])).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int as n from tis_auth_repair_archive.profile_photos')).rows[0].n, count);
  });
  await test('A conflicting Auth trigger aborts the bulk repair without partial archives or metadata loss', async () => {
    await db.exec(`create function auth.conflicting_photo_trigger() returns trigger language plpgsql as $$ begin
      if new.email='user0@example.test' then new.raw_user_meta_data := new.raw_user_meta_data || '{"avatar":"data:image/png;base64,conflict"}'::jsonb; end if;
      return new; end $$;
      create trigger zzz_fixture_conflicting_photo before update on auth.users for each row execute function auth.conflicting_photo_trigger();`);
    await db.query('update auth.users set raw_user_meta_data=raw_user_meta_data where id=$1', [ids[0]]);
    const before = (await db.query('select * from auth.users order by id')).rows;
    const archiveCount = (await db.query('select count(*)::int as n from tis_auth_repair_archive.profile_photos')).rows[0].n;
    await assert.rejects(db.exec(migration), /Another Auth trigger reintroduced photo data/);
    assert.deepEqual((await db.query('select * from auth.users order by id')).rows, before);
    assert.equal((await db.query('select count(*)::int as n from tis_auth_repair_archive.profile_photos')).rows[0].n, archiveCount);
  });
  console.log(`${passed.length} all-account PostgreSQL checks passed.`);
  console.log(passed.join('\n'));
} finally { await db.close(); }
