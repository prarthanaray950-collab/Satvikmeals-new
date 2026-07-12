'use strict';
/**
 * SatvikMeals — CSRF protection (double-submit cookie pattern)
 *
 * Why this approach: the frontend is plain HTML/JS calling a JSON API with
 * fetch() and a Bearer JWT in the Authorization header (not cookie-based
 * sessions). Classic csurf-style middleware assumes cookie sessions, so we
 * implement the double-submit pattern instead:
 *
 *   1. attachToken — on every request, ensures a random CSRF secret exists
 *      in a readable (non-HttpOnly) cookie, and exposes req.csrfToken().
 *   2. verifyToken — for state-changing requests (POST/PUT/PATCH/DELETE),
 *      requires the frontend to echo that same token back in the
 *      'X-CSRF-Token' header. A cross-site attacker's page cannot read the
 *      cookie (different origin) so it cannot set the matching header.
 *
 * Frontend usage:
 *   1. GET /api/csrf-token  → { csrfToken: "..." }   (also sets cookie)
 *   2. Include header 'X-CSRF-Token': csrfToken on every POST/PUT/PATCH/DELETE
 */

const crypto = require('crypto');

const COOKIE_NAME = 'satvik_csrf';
const HEADER_NAME = 'x-csrf-token';

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Parses cookies without needing the cookie-parser package
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = decodeURIComponent(pair.slice(idx + 1).trim());
    out[key] = val;
  });
  return out;
}

// ── Middleware 1: ensure every response carries a CSRF cookie ────────────────
function attachToken(req, res, next) {
  const cookies = parseCookies(req);
  let token = cookies[COOKIE_NAME];

  if (!token) {
    token = generateToken();

    // Only mark the cookie Secure over real HTTPS. If it were always Secure,
    // the browser would silently drop it on http:// (localhost / http preview),
    // so the double-submit header could never match the (missing) cookie and
    // EVERY write returned 403. `req.secure` is true behind Render/Nginx because
    // `app.set('trust proxy', 1)` makes Express honor X-Forwarded-Proto.
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const secureAttr = isHttps ? ' Secure;' : '';

    // Use res.append (not res.setHeader) so we don't clobber any other
    // Set-Cookie header a downstream handler may add on the same response.
    res.append('Set-Cookie',
      `${COOKIE_NAME}=${token}; Path=/; SameSite=Strict;${secureAttr} Max-Age=86400`
    );
  }

  req.csrfToken = () => token;
  next();
}

// ── Middleware 2: verify token on state-changing requests ────────────────────
function verifyToken(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();

  const cookies = parseCookies(req);
  const cookieToken  = cookies[COOKIE_NAME];
  const headerToken  = req.headers[HEADER_NAME];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ message: 'CSRF token missing or invalid. Please refresh the page and try again.' });
  }
  next();
}

module.exports = { attachToken, verifyToken, COOKIE_NAME, HEADER_NAME };
