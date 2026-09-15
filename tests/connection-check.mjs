// Run with: node tests/connection-check.mjs
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const sources = await Promise.all(['assets/supabase-config.js', 'assets/supabase-client.js', 'assets/connection-check.js'].map(file => fs.readFile(new URL(file, root), 'utf8')));
async function diagnose(failingCall = -1) {
  let click;
  const nodes = Object.fromEntries(['runChecks', 'checkSummary', 'checkResults'].map(id => [id, { textContent: '', disabled: false, addEventListener(event, handler) { click = handler; } }]));
  const requests = [];
  const window = { location: { protocol: 'http:', origin: 'http://127.0.0.1:5501' }, fetch: async (url, init) => {
    requests.push({ url, init });
    if (requests.length === failingCall) throw new TypeError('Failed to fetch');
    return { status: url.endsWith('/user') ? 401 : 200, text: async () => '{}' };
  } };
  Object.defineProperty(window, 'localStorage', { get() { throw Error('Diagnostics must not read stored sessions'); } });
  const context = vm.createContext({ window, document: { getElementById: id => nodes[id] }, URL, Headers, AbortController, setTimeout, clearTimeout, performance });
  sources.forEach(source => vm.runInContext(source, context));
  await click();
  assert.equal(nodes.runChecks.disabled, false);
  assert.ok(requests.every(request => request.init.credentials === 'omit'));
  assert.ok(requests.every(request => !request.init.method || request.init.method === 'GET'));
  assert.doesNotMatch(nodes.checkResults.textContent, /sb_publishable_|Bearer/);
  return { nodes, requests, window, click };
}
const healthy = await diagnose();
assert.equal(healthy.requests.length, 4);
assert.match(healthy.nodes.checkSummary.textContent, /All connection checks passed/);
assert.match(healthy.nodes.checkSummary.textContent, /saved login was not tested/);
assert.equal((healthy.nodes.checkResults.textContent.match(/PASS/g) || []).length, 4);
const failed = await diagnose(2);
assert.match(failed.nodes.checkSummary.textContent, /public key failed/);
assert.match(failed.nodes.checkResults.textContent, /FAIL/);
healthy.window.location.protocol = 'file:';
await healthy.click();
assert.equal(healthy.requests.length, 4);
assert.match(healthy.nodes.checkSummary.textContent, /Live Server/);

const backendWindow = { TIS_CONFIG: { supabaseUrl: 'https://test.supabase.co' } };
vm.runInNewContext(sources[1], { window: backendWindow, URL, Headers, AbortController, setTimeout, clearTimeout });
const backend = backendWindow.TISBackend;
const stalledFetch = backend.makeFetch((url, init) => new Promise((resolve, reject) => {
  init.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
}), { timeoutMs: 5, retryDelayMs: 0 });
await assert.rejects(stalledFetch('https://test.supabase.co/auth/v1/user'), error => {
  assert.match(backend.describeError(error), /timed out/);
  return true;
});
const resetFetch = backend.makeFetch(async () => { throw new TypeError('Failed to fetch'); }, { retryDelayMs: 0 });
await assert.rejects(resetFetch('https://test.supabase.co/auth/v1/user'), error => {
  assert.match(backend.describeError(error), /connection was interrupted/);
  assert.doesNotMatch(backend.describeError(error), /timed out/);
  return true;
});
for (const authHeader of ['Bearer short-fixture', 'Bearer ' + 'sensitive-fixture'.repeat(800)]) {
  for (const headers of [{ authorization: authHeader }, new Headers({ authorization: authHeader }), [['Authorization', authHeader]]]) {
    const failure = await backend.authStep('Account role', () => resetFetch('https://test.supabase.co/rest/v1/rpc/tis_is_admin', { method: 'POST', headers })).catch(error => error);
    const description = backend.describeError(failure);
    assert.ok(description.includes('Login header: ' + authHeader.length + ' bytes.'));
    assert.doesNotMatch(description, /sensitive-fixture|short-fixture|Bearer/);
    assert.equal(description.includes('unusually large'), authHeader.length > 8192);
  }
}
console.log('6 connection diagnostic checks passed (including safe header-size reporting).');
