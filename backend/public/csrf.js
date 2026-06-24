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
  if (!_csrfTokenPromise) {
    _csrfTokenPromise = fetch((window.API || '') + '/api/csrf-token', { credentials: 'include' })
      .then(r => r.json())
      .then(d => d.csrfToken)
      .catch(() => null);
  }
  return _csrfTokenPromise;
}

async function csrfHeaders(extra = {}) {
  const token = await getCsrfToken();
  return token ? { ...extra, 'X-CSRF-Token': token } : extra;
}
