/**
 * SatvikMeals — Shared CSRF helper for frontend pages.
 * Fetches a CSRF token once per page load and exposes it for use in
 * mutating requests (POST/PUT/PATCH/DELETE) via the X-CSRF-Token header.
 *
 * Usage:
 *   <script src="csrf.js"></script>
 *   ...
 *   const headers = await csrfHeaders({ 'Content-Type': 'application/json' });
 *   fetch(url, { method: 'POST', headers, body: ... });
 */
let _csrfTokenPromise = null;

function getCsrfToken() {
  // Cache the in-flight/successful promise, but if the fetch fails (network
  // blip, server waking on Render), clear the cache so the NEXT call retries.
  // The old version cached the rejected/null result forever, which meant one
  // early failure permanently broke every write on the page with a 403.
  if (!_csrfTokenPromise) {
    _csrfTokenPromise = fetch((window.API || '') + '/api/csrf-token', { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error('csrf-token HTTP ' + r.status);
        return r.json();
      })
      .then(d => {
        if (!d || !d.csrfToken) throw new Error('csrf-token missing in response');
        return d.csrfToken;
      })
      .catch(err => {
        _csrfTokenPromise = null; // allow a fresh retry next time
        throw err;
      });
  }
  return _csrfTokenPromise;
}

async function csrfHeaders(extra = {}) {
  try {
    const token = await getCsrfToken();
    return token ? { ...extra, 'X-CSRF-Token': token } : extra;
  } catch (_) {
    // Return headers without the CSRF token rather than throwing — the caller's
    // fetch still runs; if the token was truly needed the server responds 403
    // and the next attempt re-fetches a fresh token.
    return extra;
  }
}
