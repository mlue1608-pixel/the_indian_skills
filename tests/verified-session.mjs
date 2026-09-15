// Run with: node tests/verified-session.mjs
// Exercises the bundled Supabase SDK with synthetic, cryptographically signed
// tokens. No live accounts, stored sessions, or network requests are used.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
const sdkContext = vm.createContext({ crypto: webcrypto, console, URL, Headers, Request, Response, TextEncoder, TextDecoder,
  atob, btoa, setTimeout, clearTimeout, setInterval, clearInterval,
  WebSocket: class { constructor() { throw Error('Auth tests must not open a realtime connection'); } } });
vm.runInContext(await fs.readFile(new URL('../assets/vendor/supabase-2.116.0.js', import.meta.url), 'utf8'), sdkContext);
const sdk = sdkContext.supabase;
const projectUrl = 'https://session-test.supabase.co';
const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = { ...await webcrypto.subtle.exportKey('jwk', keys.publicKey), kid: 'test-key', alg: 'ES256', use: 'sig' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const claims = { sub: 'test-student', email: 'student@example.test', iss: projectUrl + '/auth/v1', exp: Math.floor(Date.now() / 1000) + 600, user_metadata: { full_name: 'Test Student' } };
async function sign(payload, kid = 'test-key') {
  const content = encode({ alg: 'ES256', typ: 'JWT', kid }) + '.' + encode(payload);
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, Buffer.from(content));
  return content + '.' + Buffer.from(signature).toString('base64url');
}
const requests = [];
const client = sdk.createClient(projectUrl, 'sb_publishable_test_fixture', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async url => {
    requests.push(String(url));
    if (String(url).endsWith('/.well-known/jwks.json')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).endsWith('/user')) return new Response(JSON.stringify({ message: 'Invalid fixture token' }), { status: 401, headers: { 'content-type': 'application/json' } });
    throw Error('Unexpected fixture request');
  } }
});
const root = { TIS_CONFIG: { supabaseUrl: projectUrl } };
vm.runInNewContext(await fs.readFile(new URL('../assets/supabase-client.js', import.meta.url), 'utf8'), { window: root, URL, Headers, AbortController, setTimeout, clearTimeout });
const verify = token => root.TISBackend.getVerifiedUser({ getClaims: () => client.auth.getClaims(token) });
const token = await sign(claims);
const user = (await verify(token)).data.user;
assert.equal(user.id, claims.sub);
assert.equal(user.email, claims.email);
assert.equal(requests.some(url => url.endsWith('/user')), false);
const segments = token.split('.');
segments[1] = encode({ ...claims, sub: 'forged-identity' });
await assert.rejects(verify(segments.join('.')), /signature/i);
await assert.rejects(verify(await sign({ ...claims, exp: 1 })), /expired/i);
await assert.rejects(verify(await sign(claims, 'unknown-key')), /Invalid fixture token/i);
assert.equal(requests.filter(url => url.endsWith('/user')).length, 1);
const headerFixture = 'Bearer private-header-fixture';
const failingClient = sdk.createClient(projectUrl, 'sb_publishable_test_fixture', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { Authorization: headerFixture }, fetch: root.TISBackend.makeFetch(async () => { throw new TypeError('Failed to fetch'); }, { retryDelayMs: 0 }) }
});
const failure = await root.TISBackend.authStep('Account role', () => failingClient.rpc('tis_is_admin')).catch(error => error);
const description = root.TISBackend.describeError(failure);
assert.ok(description.includes('Login header: ' + headerFixture.length + ' bytes.'));
assert.doesNotMatch(description, /private-header-fixture/);
console.log('5 SDK checks passed (four signature cases and safe RPC failure diagnostics).');
