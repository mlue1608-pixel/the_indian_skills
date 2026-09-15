// Run with: node tests/regression.mjs
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

export async function runRegression(root = new URL('../', import.meta.url)) {
  const source = await fs.readFile(new URL('THE_INDIAN_SKILLS.html', root), 'utf8');
  const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { id, value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, parentElement: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener() {}, focus() {}, remove() {}, appendChild() {}, setCustomValidity() {}, reset() {},
      querySelector() { return null; }, querySelectorAll() { return []; } });
    return nodes.get(id);
  };
  const calls = [];
  let response = { data: [], error: null };
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return response; },
    auth: { onAuthStateChange() {}, signOut: async () => ({ error: null }) } };
  const location = { href: 'https://example.test/sub/THE_INDIAN_SKILLS.html', origin: 'https://example.test', protocol: 'https:', search: '', hash: '', assign(url) { calls.push({ navigation: url }); } };
  const earningNodes = [0, 1, 2, 3].map(i => element('earning' + i));
  const document = { body: element('body'), getElementById: element,
    querySelector: selector => element(selector), querySelectorAll: selector => selector === '#dashboard .earning strong' ? earningNodes : [],
    addEventListener() {}, createElement: () => element('created') };
  const context = vm.createContext({ document, location, console, URL, URLSearchParams, Headers, setTimeout, clearTimeout, AbortController,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, navigator: {},
    window: { location, fetch: async () => { throw Error('Unexpected network request'); }, supabase: { createClient: () => client }, addEventListener() {}, scrollTo() {} } });
  vm.runInContext(await fs.readFile(new URL('assets/supabase-config.js', root), 'utf8'), context);
  vm.runInContext(await fs.readFile(new URL('assets/supabase-client.js', root), 'utf8'), context);
  for (const script of scripts) vm.runInContext(script, context);
  const run = code => vm.runInContext(code, context);
  const verifiedClaims = user => ({ data: { claims: { sub: user.id, email: user.email, user_metadata: user.user_metadata || {}, iss: context.window.TIS_CONFIG.supabaseUrl + '/auth/v1' } }, error: null });
  const passed = [];
  const check = async (name, fn) => { await fn(); passed.push(name); };
  await check('All five course mappings point to existing PDF files, including Finance casing', async () => {
    for (const title of ['Marketing Management', 'Branding Management', 'Traffic Management', 'Influence Management', 'Finance management']) {
      const files = run(`resolveCoursePdfCandidates(${JSON.stringify(title)})`);
      assert.equal(files.length, 1);
      const bytes = await fs.readFile(new URL(files[0], root));
      assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    }
  });
  await check('Unauthenticated PDF access shows the required enrollment message', async () => {
    run('showToast=message=>window.lastToast=message');
    await run("openCoursePdf('Marketing Management')");
    assert.equal(context.window.lastToast, 'Please enroll in this course first to access the PDF.');
    assert.equal(calls.filter(call => call.navigation).length, 0);
  });
  run("currentUser={id:'12345678-1234-1234-1234-123456789abc',email:'student@example.test',user_metadata:{full_name:'Test Student'}}");
  await check('Legacy normalized enrollment grants PDF access without matching case', async () => {
    response = { data: [{ id: 1, course_name: 'Finance Management', status: 'approved', amount: 3750 }], error: null };
    await run("openCoursePdf('Finance management')");
    assert.equal(calls.at(-1).navigation, 'https://example.test/sub/finance-management.pdf');
  });
  await check('Discounted highest-tier purchase never offers lower-tier upgrades', async () => {
    assert.match(await run('renderUpgradeCourses()'), /highest available course tier/);
    response.data = [{ id: 2, course_name: 'Influence Management', status: 'approved', amount: 2500 }];
    const upgrades = await run('renderUpgradeCourses()');
    assert.match(upgrades, /Finance Management/);
    assert.doesNotMatch(upgrades, /data-course-name="Influence Management"|data-course-name="Traffic Management"/);
  });
  await check('Database failure does not become an empty enrollment list', async () => {
    response = { data: null, error: { message: 'Connection unavailable' } };
    await assert.rejects(run('fetchEnrollments()'));
    await run("openCoursePdf('Marketing Management')");
    assert.match(context.window.lastToast, /Unable to verify course access/);
  });
  await check('Referral links use the full unique ID and preserve subdirectory hosting', async () => {
    assert.equal(await run('buildReferralLink()'), 'https://example.test/sub/THE_INDIAN_SKILLS.html?ref=12345678-1234-1234-1234-123456789abc');
  });
  await check('Referral validation resolves URL code through the database', async () => {
    response = { data: [{ id: 'referrer', referral_code: 'referrer' }], error: null };
    await run("findReferralProfile('https://example.test/?ref=referrer')");
    assert.equal(calls.at(-1).name, 'tis_resolve_referral');
    assert.equal(calls.at(-1).args.p_code, 'referrer');
  });
  await check('All four earnings periods are rendered', async () => {
    response = { data: { today: 125, week: 250, month: 500, all: 1000 }, error: null };
    await run('updateDashboardEarnings()');
    assert.deepEqual(earningNodes.map(node => node.textContent), ['₹125', '₹250', '₹500', '₹1,000']);
  });
  await check('Approval errors fail closed and approved users remain accepted', async () => {
    response = { data: null, error: { message: 'Unavailable' } };
    await assert.rejects(run('getApprovalDecision(currentUser)'));
    response = { data: 'approved', error: null };
    assert.equal((await run('getApprovalDecision(currentUser)')).blocked, false);
    response.data = 'pending';
    assert.equal((await run('getApprovalDecision(currentUser)')).blocked, true);
  });
  await check('Withdrawal UI enforces both the threshold and valid UPI', async () => {
    element('cashbackAmount').textContent = '₹999'; element('withdrawCashbackUpi').value = 'student@upi';
    run('syncCashbackWithdrawalUi()'); assert.equal(element('withdrawCashbackBtn').disabled, true);
    element('cashbackAmount').textContent = '₹1,000'; run('syncCashbackWithdrawalUi()'); assert.equal(element('withdrawCashbackBtn').disabled, false);
    element('withdrawCashbackUpi').value = 'invalid'; run('syncCashbackWithdrawalUi()'); assert.equal(element('withdrawCashbackBtn').disabled, true);
  });
  await check('Team initials are defined and escape HTML safely', async () => {
    assert.equal(run("initials('Test Student')"), 'TS');
    assert.equal(run("escapeHtml('<script>')"), '&lt;script&gt;');
  });
  await check('Checkout submits pending payment details without granting access or choosing price', async () => {
    response = { data: null, error: null };
    element('paymentModal').dataset = { courseName: 'Branding Management', referralApplied: 'false' };
    element('paymentTransactionId').value = 'UTR123456';
    run('showDashboard=async()=>{}');
    await run("processPayment(document.getElementById('testPayButton'))");
    const payment = calls.findLast(call => call.name === 'tis_submit_enrollment');
    assert.equal(payment.args.p_course, 'Branding Management');
    assert.equal(payment.args.p_transaction, 'UTR123456');
    assert.equal(payment.args.status, undefined);
    assert.equal(payment.args.amount, undefined);
    assert.match(context.window.lastToast, /Awaiting admin approval/);
  });
  await check('Signup works when email confirmation returns no session and stores no password in metadata', async () => {
    for (const [id, value] of Object.entries({ authName: 'New Student', authPhone: '9999999999', authReferral: '', authPackage: 'marketing management', authPayment: 'QR Code', authEmail: 'new@example.test', authPassword: 'test-password', authUtr: 'UTR1234567' })) element(id).value = value;
    let signup;
    client.auth.signUp = async payload => { signup = payload; return { data: { user: { id: 'new-user', identities: [{}] }, session: null }, error: null }; };
    run("authMode='signup'");
    await run('handleAuthSubmit({preventDefault(){}})');
    assert.equal(signup.options.data.tis_signup.course, 'marketing management');
    assert.equal(signup.options.data.tis_signup.transaction, 'UTR1234567');
    assert.equal(signup.options.data.password, undefined);
    assert.equal(signup.options.data.pending_password, undefined);
    assert.match(context.window.lastToast, /Registration submitted for admin approval/);
  });
  const adminSource = await fs.readFile(new URL('admin.js', root), 'utf8');
  new vm.Script(adminSource);
  await check('Admin renders live totals and pending entries from both signup sources', async () => {
    const adminContext = vm.createContext({ document, console, alert() {}, window: { location, TISBackend: context.window.TISBackend },
      supabase: { createClient: () => client } });
    vm.runInContext(adminSource.replace(/authorizeAndLoad\(\);\s*$/, ''), adminContext);
    vm.runInContext('supabaseClient = supabase.createClient()', adminContext);
    response = { data: { totalStudents: 1201, totalEnrollments: 1505, totalRevenue: 249.75,
      enrollments: [{ id: 'enrollment-1', status: 'pending', course_name: 'Marketing Management' }],
      pending: [{ id: 'legacy-1', status: 'pending', package_name: 'Branding Management' }] }, error: null };
    await vm.runInContext('loadDashboardData()', adminContext);
    assert.equal(element('totalStudents').textContent, 1201);
    assert.equal(element('totalEnrollments').textContent, 1505);
    assert.equal(element('totalRevenue').textContent, 'INR 249.75');
    assert.match(element('pendingRows').innerHTML, /data-source="enrollment"/);
    assert.match(element('pendingRows').innerHTML, /data-source="legacy"/);
  });
  await check('Read requests recover from one dropped connection', async () => {
    let attempts = 0;
    const request = context.window.TISBackend.makeFetch(async () => {
      attempts++;
      if (attempts === 1) throw new TypeError('Failed to fetch');
      return { status: 200 };
    }, { timeoutMs: 100, retryDelayMs: 0 });
    const response = await request(context.window.TIS_CONFIG.supabaseUrl + '/rest/v1/rpc/tis_my_enrollments', { method: 'POST' });
    assert.equal(response.status, 200); assert.equal(attempts, 2);
  });
  await check('Payments and withdrawals are never automatically retried', async () => {
    for (const name of ['tis_submit_enrollment', 'tis_withdraw_cashback', 'tis_approve_enrollment']) {
      let attempts = 0;
      const request = context.window.TISBackend.makeFetch(async () => { attempts++; throw new TypeError('Failed to fetch'); }, { timeoutMs: 100, retryDelayMs: 0 });
      await assert.rejects(request(context.window.TIS_CONFIG.supabaseUrl + '/rest/v1/rpc/' + name, { method: 'POST' }));
      assert.equal(attempts, 1);
    }
  });
  await check('Stalled reads are aborted and terminate after one retry', async () => {
    let attempts = 0;
    const request = context.window.TISBackend.makeFetch((input, init) => new Promise((resolve, reject) => {
      attempts++;
      init.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }), { timeoutMs: 5, retryDelayMs: 0 });
    await assert.rejects(request(context.window.TIS_CONFIG.supabaseUrl + '/rest/v1/rpc/tis_team', { method: 'POST' }));
    assert.equal(attempts, 2);
  });
  await check('Missing migrations are reported distinctly from network failure', async () => {
    assert.match(context.window.TISBackend.describeError({ code: 'PGRST202', message: 'Could not find the function' }), /database update has not been deployed/);
    assert.match(context.window.TISBackend.describeError({ message: 'Failed to fetch' }), /connection was interrupted/);
  });
  await check('Local file launch stops SDK initialization and offers the HTTP page', async () => {
    location.protocol = 'file:';
    let sdkCalls = 0;
    assert.throws(() => context.window.TISBackend.createClient({ createClient() { sdkCalls++; } }), error => {
      assert.equal(error.code, 'TIS_LOCAL_FILE');
      run(`backendSetupError=Object.assign(new Error(${JSON.stringify(error.message)}),{code:'TIS_LOCAL_FILE'})`);
      return true;
    });
    assert.equal(sdkCalls, 0);
    await run('restoreSession()');
    assert.match(element('backendStatusMessage').textContent, /Live Server/);
    assert.equal(element('backendRetry').hidden, true);
    assert.equal(element('backendLocalLink').hidden, false);
    assert.equal(element('backendLocalLink').href, 'http://127.0.0.1:5501/THE_INDIAN_SKILLS.html');
    run('backendSetupError=null');
    location.protocol = 'https:';
  });
  await check('Offline requests do not contact Supabase and can recover after reconnecting', async () => {
    context.window.navigator = { onLine: false };
    let attempts = 0;
    const request = context.window.TISBackend.makeFetch(async () => { attempts++; return { status: 200 }; });
    await assert.rejects(request(context.window.TIS_CONFIG.supabaseUrl + '/auth/v1/user'), error => {
      assert.match(context.window.TISBackend.describeError(error), /device is offline/);
      return true;
    });
    assert.equal(attempts, 0);
    context.window.navigator.onLine = true;
    assert.equal((await request(context.window.TIS_CONFIG.supabaseUrl + '/auth/v1/user')).status, 200);
    assert.equal(attempts, 1);
  });
  await check('Overlapping session restores share one verification and recover after a network error', async () => {
    let sessionCalls = 0, userCalls = 0, signOutCalls = 0;
    const savedUser = { id: 'restored-student', email: 'student@example.test' };
    client.auth.getSession = async () => { sessionCalls++; return { data: { session: { user: savedUser } }, error: null }; };
    client.auth.getClaims = async () => { userCalls++; return { data: null, error: { message: 'Failed to fetch' } }; };
    client.auth.signOut = async () => { signOutCalls++; return { error: null }; };
    const first = run('restoreSession()');
    const second = run('restoreSession()');
    assert.equal(first, second);
    assert.equal((await first).ok, false);
    assert.equal(sessionCalls, 1);
    assert.equal(userCalls, 1);
    assert.equal(signOutCalls, 0);
    assert.equal(run('currentUser'), null);
    assert.match(element('backendStatusMessage').textContent, /connection was interrupted/);
    assert.equal(element('backendRetry').hidden, false);
    assert.equal(element('backendLocalLink').hidden, true);
    client.auth.getClaims = async () => verifiedClaims(savedUser);
    const previousRpc = client.rpc;
    client.rpc = async name => ({ data: name === 'tis_is_admin' ? false : 'approved', error: null });
    await run('retryBackend()');
    assert.equal(sessionCalls, 2);
    assert.equal(run('currentUser.id'), savedUser.id);
    assert.equal(element('backendStatus').hidden, true);
    assert.equal(signOutCalls, 0);
    client.rpc = previousRpc;
  });
  await check('Login failures identify verification, role, or approval without granting access', async () => {
    const user = { id: 'diagnostic-student', email: 'student@example.test' };
    const savedRpc = client.rpc;
    for (const [failingStep, expected] of [
      ['user', 'Saved login signature verification'],
      ['tis_is_admin', 'Account role (POST /rest/v1/rpc/tis_is_admin)'],
      ['tis_approval_status', 'Account approval (POST /rest/v1/rpc/tis_approval_status)']
    ]) {
      client.auth.getClaims = async () => failingStep === 'user'
        ? { data: null, error: { message: 'Failed to fetch' } }
        : verifiedClaims(user);
      client.rpc = async name => name === failingStep
        ? { data: null, error: { message: 'Failed to fetch' } }
        : { data: name === 'tis_is_admin' ? false : 'approved', error: null };
      const result = await run(`initializeAuth(${JSON.stringify(user)})`);
      assert.equal(result.ok, false);
      assert.equal(run('currentUser'), null);
      assert.ok(element('backendStatusMessage').textContent.startsWith(expected));
      assert.doesNotMatch(element('backendStatusMessage').textContent, /Use Check connection/);
    }
    client.rpc = savedRpc;
  });
  await check('Password and session-refresh failures have distinct actionable labels', async () => {
    client.auth.signInWithPassword = async () => ({ data: null, error: { message: 'Failed to fetch' } });
    element('authEmail').value = 'student@example.test';
    element('authPassword').value = 'test-password';
    run("authMode='login'");
    await run('handleAuthSubmit({preventDefault(){}})');
    assert.match(element('authError').textContent, /^Password sign-in \(POST \/auth\/v1\/token\)/);
    assert.equal(element('authSubmit').disabled, false);
    client.auth.getSession = async () => ({ data: null, error: { message: 'Connection timed out' } });
    await run('restoreSession()');
    assert.match(element('backendStatusMessage').textContent, /^Restoring saved login/);
    assert.match(element('backendStatusMessage').textContent, /request timed out/);
    const failure = await context.window.TISBackend.authStep('Password sign-in', async () => ({ error: { message: 'Invalid login credentials', status: 400 } })).catch(error => error);
    assert.equal(context.window.TISBackend.describeError(failure), 'Password sign-in: Invalid login credentials');
  });
  await check('Successful password sign-in avoids redundant Auth reads but still checks role and approval', async () => {
    const user = { id: 'fresh-student', email: 'fresh@example.test' };
    const savedRpc = client.rpc;
    const checked = [];
    let redundantReads = 0;
    client.auth.getUser = client.auth.getClaims = async () => { redundantReads++; throw Error('Unexpected Auth lookup'); };
    client.auth.signInWithPassword = async () => ({ data: { user }, error: null });
    client.rpc = async name => { checked.push(name); return { data: name === 'tis_is_admin' ? false : 'approved', error: null }; };
    run("authMode='login';closeAuthModal=async()=>{}");
    await run('handleAuthSubmit({preventDefault(){}})');
    assert.equal(redundantReads, 0);
    assert.equal(run('currentUser.id'), user.id);
    assert.deepEqual(checked, ['tis_is_admin', 'tis_approval_status']);
    assert.equal(context.window.lastToast, 'Signed in successfully.');
    client.rpc = async name => ({ data: name === 'tis_is_admin' ? false : 'pending', error: null });
    await run('handleAuthSubmit({preventDefault(){}})');
    assert.equal(run('currentUser'), null);
    assert.match(element('authError').textContent, /pending admin approval/);
    client.rpc = savedRpc;
  });
  await check('Fresh sign-in waits out failed restoration and initializes the new identity', async () => {
    let rejectOld;
    const oldClaims = new Promise((resolve, reject) => { rejectOld = reject; });
    client.auth.getClaims = () => oldClaims;
    const savedRpc = client.rpc;
    client.rpc = async name => ({ data: name === 'tis_is_admin' ? false : 'approved', error: null });
    const old = run("initializeAuth({id:'old-session'})");
    const fresh = run("initializeAuth({id:'new-session',email:'new@example.test'},{verifiedBySignIn:true})");
    rejectOld(new Error('Failed to fetch'));
    assert.equal((await old).ok, false);
    assert.equal((await fresh).ok, true);
    assert.equal(run('currentUser.id'), 'new-session');
    assert.equal(element('backendStatus').hidden, true);
    client.rpc = savedRpc;
  });
  await check('Restoration uses verified claims instead of cached identity and rejects missing or foreign claims', async () => {
    const savedRpc = client.rpc;
    client.rpc = async name => ({ data: name === 'tis_is_admin' ? false : 'approved', error: null });
    client.auth.getClaims = async () => verifiedClaims({ id: 'signed-identity', email: 'signed@example.test' });
    assert.equal((await run("initializeAuth({id:'untrusted-cache',email:'wrong@example.test'})")).ok, true);
    assert.equal(run('currentUser.id'), 'signed-identity');
    for (const claims of [null, { sub: 'foreign', iss: 'https://other.supabase.co/auth/v1' }]) {
      client.auth.getClaims = async () => ({ data: { claims }, error: null });
      assert.equal((await run("initializeAuth({id:'untrusted-cache'})")).ok, false);
      assert.equal(run('currentUser'), null);
    }
    client.rpc = savedRpc;
  });
  await check('Profile saves keep image data local and out of Auth metadata', async () => {
    const localPhoto = 'data:image/png;base64,local-photo-fixture';
    const oldPhoto = 'data:image/png;base64,old-server-photo';
    const storage = new Map([['tisProfileImage_photo-user', localPhoto]]);
    const previousStorage = { ...context.localStorage };
    context.localStorage.getItem = key => storage.get(key) || null;
    context.localStorage.setItem = (key, value) => storage.set(key, value);
    run(`currentUser={id:'photo-user',email:'photo@example.test',user_metadata:{avatar:${JSON.stringify(oldPhoto)}}}`);
    assert.equal(run('getProfileAvatar()'), localPhoto);
    element('editName').value = 'Photo Student';
    element('editEmail').value = 'photo@example.test';
    let savedAttributes;
    client.auth.updateUser = async attributes => {
      savedAttributes = attributes;
      return { data: { user: { id: 'photo-user', email: 'photo@example.test', user_metadata: { avatar: oldPhoto } } }, error: null };
    };
    response = { data: null, error: null };
    await run('saveProfile()');
    assert.equal(savedAttributes.data.full_name, 'Photo Student');
    assert.equal(savedAttributes.data.avatar, undefined);
    assert.equal(savedAttributes.data.profile_picture, undefined);
    assert.doesNotMatch(JSON.stringify(savedAttributes), /data:image/);
    assert.equal(storage.get('tisProfileImage_photo-user'), localPhoto);
    Object.assign(context.localStorage, previousStorage);
  });
  await check('Oversized saved sessions refresh once while small sessions and errors stay intact', async () => {
    let refreshes = 0;
    let sessionResult = { data: { session: { access_token: 'x'.repeat(132095), user: { id: 'test' } } }, error: null };
    const refreshed = { data: { session: { access_token: 'small-fresh-token', user: { id: 'test' } } }, error: null };
    const auth = { getSession: async () => sessionResult, refreshSession: async () => { refreshes++; return refreshed; } };
    assert.equal(await context.window.TISBackend.getUsableSession(auth), refreshed);
    assert.equal(refreshes, 1);
    sessionResult = refreshed;
    assert.equal(await context.window.TISBackend.getUsableSession(auth), refreshed);
    assert.equal(refreshes, 1);
    sessionResult = { data: { session: null }, error: null };
    assert.equal(await context.window.TISBackend.getUsableSession(auth), sessionResult);
    sessionResult = { data: null, error: { message: 'refresh failed' } };
    assert.equal(await context.window.TISBackend.getUsableSession(auth), sessionResult);
    sessionResult = { data: { session: { access_token: 'x'.repeat(132095) } }, error: null };
    auth.refreshSession = async () => { refreshes++; return sessionResult; };
    assert.equal(await context.window.TISBackend.getUsableSession(auth), sessionResult);
    assert.equal(refreshes, 2);
  });
  return passed;
}

// Importing this module also runs the checks, so it works in constrained runtimes.
export const results = await runRegression();
console.log(`${results.length} regression checks passed.`);
