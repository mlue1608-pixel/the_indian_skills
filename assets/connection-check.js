(function (root) {
  'use strict';
  async function runChecks() {
    const button = document.getElementById('runChecks');
    const summary = document.getElementById('checkSummary');
    const output = document.getElementById('checkResults');
    if (button.disabled) return;
    if (!['http:', 'https:'].includes(root.location.protocol)) {
      summary.textContent = 'Open this page through Live Server, using http://127.0.0.1:5501/connection-check.html.';
      return;
    }
    button.disabled = true;
    summary.textContent = 'Checking this browser’s connection to Supabase…';
    output.textContent = 'Running…';
    try {
      const config = root.TIS_CONFIG;
      const nativeFetch = root.fetch.bind(root);
      const appFetch = root.TISBackend.makeFetch(nativeFetch, { timeoutMs: 12000, retryDelayMs: 350 });
      const headers = { apikey: config.supabasePublishableKey, 'x-app-name': 'the-indian-skills' };
      const checks = [
        { name: 'Basic browser request', path: '/auth/v1/user', expected: [401], headers: {} },
        { name: 'Public key and browser permission (CORS)', path: '/auth/v1/settings', expected: [200], headers },
        // Deliberately invalid: exercises the Authorization header without accessing any saved session.
        { name: 'Auth endpoint with request headers (no login token)', path: '/auth/v1/user', expected: [401, 403], headers: { ...headers, Authorization: 'Bearer tis-connection-check-not-a-user-token', 'x-client-info': 'supabase-js-web/2.116.0' } },
        { name: 'Website request wrapper', path: '/auth/v1/settings', expected: [200], headers, fetch: appFetch }
      ];
      const results = await Promise.all(checks.map(async check => {
        const controller = new AbortController();
        const start = performance.now();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
        try {
          const response = await (check.fetch || nativeFetch)(config.supabaseUrl + check.path,
            { headers: check.headers, credentials: 'omit', cache: 'no-store', signal: controller.signal });
          // Consume the response too: a connection can fail after the headers arrive.
          await response.text();
          const ok = check.expected.includes(response.status);
          return { name: check.name, ok, detail: 'HTTP ' + response.status + (ok ? ' (expected)' : ' (unexpected response)'), ms: Math.round(performance.now() - start) };
        } catch (error) {
          return { name: check.name, ok: false, detail: timedOut ? 'Timed out after 15 seconds' :
            /timed? out/i.test(error.message) ? 'Website request timed out' : 'Browser could not complete the request; inspect Network for the browser error', ms: Math.round(performance.now() - start) };
        } finally { clearTimeout(timer); }
      }));
      output.textContent = 'Checked: ' + new Date().toISOString() + '\nPage origin: ' + root.location.origin + '\n\n' +
        results.map(result => (result.ok ? 'PASS' : 'FAIL') + ' — ' + result.name + '\n' + result.detail + ' · ' + result.ms + ' ms').join('\n\n');
      if (results.every(result => result.ok)) {
        summary.textContent = 'All connection checks passed at this moment. Your saved login was not tested. If sign-in still fails, open the website’s Network tab, retry sign-in, and report only the failed request path and status/error (not its headers).';
      } else if (results[0].ok && !results[1].ok) {
        summary.textContent = 'The basic request worked, but the request with the public key failed. Check the failed Network request and any OPTIONS request; this narrows the issue to that request or its browser permission check.';
      } else if (results.slice(0, 3).every(result => result.ok) && !results[3].ok) {
        summary.textContent = 'Direct requests worked, but the website request wrapper failed. This may be its timeout or an intermittent failure. Share these results so the difference can be investigated.';
      } else {
        summary.textContent = 'Some requests failed. These results alone cannot identify whether the cause is the browser, network route, or Supabase. Share the results to narrow it down.';
      }
    } catch {
      summary.textContent = 'The connection check could not start. Refresh this page to reload its configuration.';
      output.textContent = 'Check setup unavailable.';
    } finally { button.disabled = false; }
  }
  document.getElementById('runChecks').addEventListener('click', runChecks);
})(window);
