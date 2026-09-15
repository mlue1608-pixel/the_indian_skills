(function (root) {
  'use strict';
  const readFunctions = new Set([
    'tis_resolve_referral', 'tis_is_admin', 'tis_my_enrollments', 'tis_approval_status',
    'tis_earnings_summary', 'tis_leaderboard', 'tis_team', 'tis_admin_dashboard'
  ]);

  function describeError(error) {
    if (error?.code === 'TIS_AUTH_STEP') {
      const causeMessage = String(error.cause?.message || '');
      if (/failed to fetch|network|fetch failed|timed? out|connection interrupted/i.test(causeMessage)) {
        return error.step + ': ' + (/timed? out/i.test(causeMessage) ? 'the request timed out.' : 'the connection was interrupted.') +
          headerSizeDiagnostic(causeMessage) + ' Please share this full message with support.';
      }
      return error.step + ': ' + describeError(error.cause);
    }
    const message = String(error?.message || error?.details || error || '');
    if (error?.code === 'TIS_LOCAL_FILE') return message;
    if (error?.code === 'TIS_OFFLINE' || /device is offline/i.test(message)) {
      return 'Your device is offline. Reconnect to the internet, then retry.';
    }
    if (['PGRST202', 'PGRST204', 'PGRST205', '42P01', '42703', '42883'].includes(error?.code) || /could not find the (function|table|column)|(?:relation|column|function) .+ does not exist/i.test(message)) {
      return 'The database update has not been deployed yet. Please contact support.';
    }
    if (['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'].includes(error?.code)) {
      return 'The database is temporarily unavailable. Please retry in a moment.';
    }
    if (/timed? out/i.test(message)) {
      return 'The request to Supabase timed out. Use Check connection for details, then retry.';
    }
    if (/failed to fetch|network|fetch failed|abort|connection/i.test(message)) {
      return 'The connection was interrupted. Use Check connection to investigate, then retry.';
    }
    if (error?.code === '42501') return 'Your account does not have access to this data. Please contact support.';
    return message || 'Unable to load data. Please retry.';
  }

  function headerSizeDiagnostic(message) {
    const match = /\[Auth header size: (\d+) bytes\]/.exec(message);
    if (!match) return '';
    const size = Number(match[1]);
    return ' Login header: ' + size + ' bytes.' + (size > 8192
      ? ' This is unusually large and may exceed server header limits. Profile-photo metadata may need repair.' : '');
  }

  async function authStep(step, operation) {
    try {
      const result = await operation();
      if (result?.error) throw result.error;
      return result;
    } catch (cause) {
      throw Object.assign(new Error('Authentication step failed.', { cause }), { code: 'TIS_AUTH_STEP', step });
    }
  }

  async function getVerifiedUser(auth) {
    // getClaims verifies the signature and expiry; never use a decoded-only JWT
    // or the cached session.user as proof of identity. Legacy signing keys are
    // verified by the SDK's Auth-server fallback, with no fail-open behavior.
    const { data, error } = await auth.getClaims();
    if (error) throw error;
    const claims = data?.claims;
    if (!claims?.sub || claims.iss !== root.TIS_CONFIG.supabaseUrl + '/auth/v1') {
      throw new Error('Your saved login could not be verified. Please sign in again.');
    }
    return { data: { user: {
      id: claims.sub,
      email: claims.email || '',
      user_metadata: claims.user_metadata || {},
      app_metadata: claims.app_metadata || {}
    } }, error: null };
  }

  async function getUsableSession(auth) {
    const result = await auth.getSession();
    if (result.error || !result.data?.session) return result;
    // Database cleanup cannot change an already issued JWT. Refresh once to
    // replace an oversized saved token; do not loop if metadata is still large.
    if ((result.data.session.access_token || '').length > 8192) return auth.refreshSession();
    return result;
  }

  function makeFetch(fetchImpl, { timeoutMs = 12000, retryDelayMs = 350 } = {}) {
    return async function request(input, init = {}) {
      const method = String(init.method || input?.method || 'GET').toUpperCase();
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const trusted = url.origin === new URL(root.TIS_CONFIG.supabaseUrl).origin;
      // Supabase JWTs are ASCII. Report only the outgoing header length, never
      // the token, its claims, a URL query string, or the user's credentials.
      const authHeaderSize = trusted ? (new Headers(init.headers || input?.headers).get('authorization') || '').length : 0;
      const readOnly = trusted && (['GET', 'HEAD'].includes(method) ||
        (method === 'POST' && url.pathname.startsWith('/rest/v1/rpc/') && readFunctions.has(url.pathname.split('/').pop())));
      const callerSignal = init.signal || input?.signal;
      for (let attempt = 0; ; attempt++) {
        if (callerSignal?.aborted) throw new Error('Request cancelled.');
        if (root.navigator?.onLine === false) {
          throw Object.assign(new Error('Your device is offline. Reconnect to the internet, then retry.'), { code: 'TIS_OFFLINE' });
        }
        const controller = new AbortController();
        const cancel = () => controller.abort(callerSignal?.reason);
        if (callerSignal?.aborted) cancel();
        else callerSignal?.addEventListener('abort', cancel, { once: true });
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        let retry = false;
        try {
          const response = await fetchImpl(input, { ...init, signal: controller.signal });
          retry = readOnly && attempt === 0 && !callerSignal?.aborted && [502, 503, 504].includes(response.status);
          if (!retry) return response;
          await response.body?.cancel();
        } catch (error) {
          retry = readOnly && attempt === 0 && !callerSignal?.aborted;
          if (!retry) {
            const message = callerSignal?.aborted ? 'Request cancelled.' :
              timedOut ? 'Connection timed out. Please retry.' : 'Connection interrupted. Please retry.';
            throw new Error(message + (trusted ? ' [Auth header size: ' + authHeaderSize + ' bytes]' : ''), { cause: error });
          }
        } finally {
          clearTimeout(timer);
          callerSignal?.removeEventListener('abort', cancel);
        }
        if (retry) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    };
  }

  function createClient(sdk) {
    if (root.location?.protocol === 'file:') {
      throw Object.assign(new Error('Open this site with VS Code Live Server (port 5501), then use http://127.0.0.1:5501/THE_INDIAN_SKILLS.html. Sign-in requires an HTTP or HTTPS page.'), { code: 'TIS_LOCAL_FILE' });
    }
    if (!sdk?.createClient) throw new Error('The Supabase SDK could not load. Refresh this page.');
    const config = root.TIS_CONFIG;
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config?.supabaseUrl || '') ||
        !config?.supabasePublishableKey || /^(sb_secret_|sbp_)/.test(config.supabasePublishableKey)) {
      throw new Error('Invalid public Supabase configuration.');
    }
    return sdk.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true },
      db: { retry: false },
      global: { fetch: makeFetch(root.fetch.bind(root)), headers: { 'x-app-name': 'the-indian-skills' } }
    });
  }
  root.TISBackend = Object.freeze({ createClient, makeFetch, describeError, authStep, getVerifiedUser, getUsableSession });
})(window);
