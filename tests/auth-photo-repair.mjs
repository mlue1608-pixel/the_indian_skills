// Run: node tests/auth-photo-repair.mjs
// Uses @electric-sql/pglite, or its local test download. No live database access.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); }
catch { ({ PGlite } = await import('../.local/pglite-test/package/dist/index.js')); }
const template = await fs.readFile(new URL('../scripts/repair-auth-photo.sql', import.meta.url), 'utf8');
const verifyTemplate = await fs.readFile(new URL('../scripts/verify-auth-photo.sql', import.meta.url), 'utf8');
const repair = email => template.replace("target_email text := 'REPLACE_WITH_LOGIN_EMAIL';", `target_email text := '${email}';`);
const db = await PGlite.create();
const passed = [];
const test = async (name, fn) => { await fn(); passed.push(name); };
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (
      id uuid primary key, email text, raw_user_meta_data jsonb,
      raw_app_meta_data jsonb default '{"role":"student"}',
      encrypted_password text default 'unchanged-password-fixture', updated_at timestamptz
    );
  `);
  const target = '00000000-0000-4000-8000-000000000001';
  const other = '00000000-0000-4000-8000-000000000002';
  const photo = 'data:image/png;base64,' + 'a'.repeat(185000);
  const metadata = { full_name: 'Test Student', avatar: photo, profile_picture: 'data:image/jpeg;base64,backup',
    tis_signup: { course: 'marketing management', transaction: 'fixture-utr' }, preferences: { theme: 'dark' } };
  const cleanMetadata = { ...metadata };
  delete cleanMetadata.avatar; delete cleanMetadata.profile_picture;
  await db.query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3),($4,$5,$6)',
    [target, 'target@example.test', metadata, other, 'other@example.test', metadata]);
  const readUser = async id => (await db.query('select * from auth.users where id=$1', [id])).rows[0];
  const otherBefore = await readUser(other);
  const targetBefore = await readUser(target);

  await test('Atomic repair preserves account fields and other users', async () => {
    await db.exec(repair('target@example.test'));
    const after = await readUser(target);
    assert.deepEqual(after.raw_user_meta_data, cleanMetadata);
    assert.equal(after.id, targetBefore.id);
    assert.equal(after.email, targetBefore.email);
    assert.equal(after.encrypted_password, targetBefore.encrypted_password);
    assert.deepEqual(after.raw_app_meta_data, targetBefore.raw_app_meta_data);
    assert.deepEqual(await readUser(other), otherBefore);
    const archived = (await db.query('select * from tis_auth_repair_archive.profile_photos')).rows;
    assert.equal(archived.length, 1);
    assert.deepEqual(archived[0].photo_metadata, { avatar: photo, profile_picture: metadata.profile_picture });
    assert.ok(archived[0].metadata_bytes_before > 180000);
    assert.ok(archived[0].metadata_bytes_after < 1000);
  });
  await test('Photo archive cannot be read by browser roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      const permission = (await db.query(`select has_schema_privilege($1,'tis_auth_repair_archive','USAGE') as schema_access,
        has_table_privilege($1,'tis_auth_repair_archive.profile_photos','SELECT') as table_access`, [role])).rows[0];
      assert.equal(permission.schema_access, false);
      assert.equal(permission.table_access, false);
      await db.exec('set role ' + role);
      try { await assert.rejects(db.query('select * from tis_auth_repair_archive.profile_photos'), /permission denied/); }
      finally { await db.exec('reset role'); }
    }
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='tis_auth_repair_archive.profile_photos'::regclass")).rows[0].relrowsecurity, true);
  });
  await test('Rerunning an already repaired account is a no-op', async () => {
    const before = await readUser(target);
    await db.exec(repair('target@example.test'));
    assert.deepEqual(await readUser(target), before);
    assert.equal((await db.query('select count(*)::int as count from tis_auth_repair_archive.profile_photos')).rows[0].count, 1);
  });
  await test('Independent verification does not depend on a temporary table', async () => {
    const result = (await db.query(verifyTemplate.replace('REPLACE_WITH_LOGIN_EMAIL', 'target@example.test'))).rows[0];
    assert.ok(result.metadata_bytes < 1000);
    assert.match(result.result, /No embedded photo fields remain/);
    assert.doesNotMatch(template, /create temporary table|tis_photo_repair_result/i);
  });
  await test('Oversized non-photo metadata leaves the account unchanged', async () => {
    const oversized = { avatar: photo, unrelated: 'x'.repeat(9000) };
    await db.query('update auth.users set raw_user_meta_data=$1 where id=$2', [oversized, other]);
    await assert.rejects(db.exec(repair('other@example.test')), /Other metadata is also large/);
    assert.deepEqual((await readUser(other)).raw_user_meta_data, oversized);
    assert.equal((await db.query('select count(*)::int as count from tis_auth_repair_archive.profile_photos')).rows[0].count, 1);
  });
  await test('Trigger interference rolls back both the account update and photo backup', async () => {
    await db.query('update auth.users set raw_user_meta_data=$1 where id=$2', [metadata, other]);
    await db.exec(`create function auth.fixture_trigger() returns trigger language plpgsql as $$ begin
      if new.email='other@example.test' then new.raw_user_meta_data := new.raw_user_meta_data || '{"trigger_change":true}'::jsonb; end if;
      return new; end $$;
      create trigger fixture_trigger before update on auth.users for each row execute function auth.fixture_trigger();`);
    const before = await readUser(other);
    await assert.rejects(db.exec(repair('other@example.test')), /database trigger changed the result/);
    assert.deepEqual(await readUser(other), before);
    assert.equal((await db.query('select count(*)::int as count from tis_auth_repair_archive.profile_photos')).rows[0].count, 1);
  });
  await test('Unconfigured, missing, and ambiguous email targets fail without changing accounts', async () => {
    await assert.rejects(db.exec(template), /Set target_email/);
    await assert.rejects(db.exec(repair('missing@example.test')), /query returned no rows/);
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)',
      ['00000000-0000-4000-8000-000000000003', 'target@example.test', metadata]);
    await assert.rejects(db.exec(repair('target@example.test')), /query returned more than one row/);
    assert.deepEqual((await readUser(target)).raw_user_meta_data, cleanMetadata);
    assert.equal((await db.query('select count(*)::int as count from tis_auth_repair_archive.profile_photos')).rows[0].count, 1);
  });
  console.log(`${passed.length} PostgreSQL photo repair checks passed.`);
  console.log(passed.join('\n'));
} finally { await db.close(); }
