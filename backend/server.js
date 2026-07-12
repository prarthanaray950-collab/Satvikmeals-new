require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const mongoose     = require('mongoose');
const path         = require('path');
const helmet       = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit    = require('express-rate-limit');
const xssClean     = require('./middleware/xssClean');
const csrf         = require('./middleware/csrf');

const authRoutes      = require('./routes/auth');
const planRoutes      = require('./routes/plans');
const menuRoutes      = require('./routes/menu');
const userRoutes      = require('./routes/user');
const adminRoutes     = require('./routes/admin');
const orderRoutes     = require('./routes/orders');
const complaintRoutes = require('./routes/complaints');
const { autoReconnectIfSessionExists } = require('./utils/whatsapp');
const { startCron }          = require('./utils/cron');
const { startReminderCron }  = require('./utils/reminders');
const { startReportCron }    = require('./utils/dailyReport');
const { startInvoiceCron }   = require('./utils/invoice');

const app = express();

// ── Trust proxy (needed for correct IP detection behind Render/Heroku/Nginx) ──
app.set('trust proxy', 1);

// ── Canonical host + HTTPS redirect ──────────────────────────────────────────
// Fixes Google Search Console's "Duplicate without user-selected canonical":
// the site must be reachable at exactly ONE URL. We force:
//   www.satvikmeals.in   → satvikmeals.in   (drop www)
//   http://              → https://          (secure)
// This matches the extensionless canonical tags across the site. It is a safety
// net in case the Hostinger/Render domain settings don't already enforce it;
// if they do, this simply never fires. Guards:
//   - Only redirects the known production domain, so the *.onrender.com URL and
//     localhost keep working untouched (no redirect loops during testing).
//   - X-Forwarded-Proto is honored because trust proxy is set above.
const CANONICAL_HOST = process.env.CANONICAL_HOST || 'satvikmeals.in';
app.use((req, res, next) => {
  const host  = (req.headers.host || '').toLowerCase();
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const isProdDomain = host === CANONICAL_HOST || host === 'www.' + CANONICAL_HOST;
  if (!isProdDomain) return next(); // onrender.com / localhost — leave alone

  const needsHostFix  = host === 'www.' + CANONICAL_HOST;
  const needsHttpsFix = proto !== 'https';
  if (needsHostFix || needsHttpsFix) {
    return res.redirect(301, 'https://' + CANONICAL_HOST + req.originalUrl);
  }
  next();
});

// ── Security headers ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // keep disabled — site uses inline scripts/styles on many pages
  crossOriginEmbedderPolicy: false,
  // 'same-origin' (helmet's default) blocks the Google Sign-In popup's
  // postMessage back to this window, causing a blank/frozen screen after
  // choosing a Google account. 'same-origin-allow-popups' keeps the same
  // protection level for everything else while permitting that handshake.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

// ── CORS — restrict to known origins instead of wildcard ─────────────────────
// IMPORTANT: set ALLOWED_ORIGINS in your Render environment to your exact
// live domain(s), comma-separated, e.g.:
//   ALLOWED_ORIGINS=https://satvikmeals.in,https://www.satvikmeals.in
// If this env var is missing or wrong, every API call (including Google
// Sign-In) gets silently blocked and the page appears to freeze/blank out
// after picking a Google account. The fallback list below is just for local
// dev — do not rely on it in production.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://satvikmeals.in,https://www.satvikmeals.in,http://localhost:3000,http://localhost:5000')
  .split(',').map(o => o.trim()).filter(Boolean);
console.log('[CORS] Allowed origins:', allowedOrigins);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no Origin header (same-origin page loads, curl,
    // server-to-server, native mobile apps). Browsers always send Origin on
    // cross-site requests, so this does not weaken cross-site protection.
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Fail CLOSED — an unknown cross-origin site is not allowed to make
    // credentialed API calls. If a legitimate domain is blocked (e.g. the
    // .onrender.com URL before DNS cutover, or a new www/apex variant), add it
    // to ALLOWED_ORIGINS in the Render env vars — do not weaken this check.
    console.warn(`[CORS] Blocked cross-origin request from "${origin}". ` +
      `Add it to ALLOWED_ORIGINS if this domain is legitimate.`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

// ── NoSQL injection prevention — strips $ and . from req.body/query/params ───
app.use(mongoSanitize());

// ── XSS prevention — sanitizes script/html tags from string inputs ───────────
app.use(xssClean());

// ── Rate limiting — prevents brute force / abuse ─────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 300,                    // 300 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' }
});
app.use('/api/', generalLimiter);

// Stricter limiter for auth endpoints — prevents credential stuffing / OTP abuse
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many auth attempts. Please try again in 15 minutes.' }
});
app.use('/api/auth/', authLimiter);

// ── Clean URLs + 301 redirects ───────────────────────────────────────────────
// SEO: canonical URLs are extensionless (e.g. /tiffin-service-patna). We 301
// redirect the old *.html URLs to the clean form so existing links/backlinks
// consolidate onto one canonical URL, then serve the underlying .html file for
// the clean path. Runs BEFORE express.static so static never answers *.html
// directly. API routes are untouched (guarded by the /api and '.' checks).
const PUBLIC_DIR = path.join(__dirname, 'public');

// 1) Redirect "/foo.html" → "/foo" (permanent). Skip index.html → "/".
app.get(/\.html$/i, (req, res, next) => {
  // Never touch API or files with a query we can't clean; only GET page loads.
  const cleanPath = req.path.replace(/\.html$/i, '');
  if (req.path === '/index.html') {
    return res.redirect(301, '/' + (req._parsedUrl.search || ''));
  }
  const search = req._parsedUrl && req._parsedUrl.search ? req._parsedUrl.search : '';
  return res.redirect(301, cleanPath + search);
});

// 2) Serve the clean extensionless path by mapping it to its .html file, if one
// exists. Anything not matching a real .html file falls through to static/404.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api/')) return next();
  // Skip paths that already have a file extension (.css, .js, .png, .svg, .xml…)
  if (path.extname(req.path)) return next();
  if (req.path === '/') return next(); // handled by the '/' route below
  const candidate = path.join(PUBLIC_DIR, req.path + '.html');
  // Prevent path traversal — candidate must stay inside PUBLIC_DIR
  if (!candidate.startsWith(PUBLIC_DIR)) return next();
  return res.sendFile(candidate, err => { if (err) next(); });
});

app.use(express.static(path.join(__dirname, 'public')));

// ── CSRF protection — issues + validates token for state-changing requests ───
app.use(csrf.attachToken);   // sets req.csrfToken() and a readable cookie
app.get('/api/csrf-token', (req, res) => res.json({ csrfToken: req.csrfToken() }));

app.use('/api/auth',    authRoutes);
app.use('/api/plans',   planRoutes);
app.use('/api/menu',    menuRoutes);
app.use('/api/user',    csrf.verifyToken, userRoutes);
app.use('/api/admin',   csrf.verifyToken, adminRoutes);
app.use('/api/orders',  csrf.verifyToken, orderRoutes);
app.use('/api',         csrf.verifyToken, complaintRoutes);
// Note: /api/auth is NOT globally CSRF-protected because /google and /dev-login
// are unauthenticated entry points with no prior session to carry a token.
// The phone/location routes inside auth.js are protected individually below.

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'SatvikMeals' }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Drops the old non-sparse phone_1 index if it exists, then lets
// Mongoose recreate it correctly as sparse. Safe to run every deploy.
async function fixPhoneIndex() {
  try {
    const collection = mongoose.connection.db.collection('users');
    const indexes = await collection.indexes();
    const phoneIndex = indexes.find(i => i.name === 'phone_1');

    if (phoneIndex && !phoneIndex.sparse) {
      await collection.dropIndex('phone_1');
      console.log('✅ Dropped old non-sparse phone_1 index');
    } else {
      console.log('✅ phone index is fine, no action needed');
    }

    // Let Mongoose sync the correct sparse index
    await mongoose.model('User').syncIndexes();
    console.log('✅ User indexes synced');
  } catch (err) {
    console.error('⚠️ fixPhoneIndex error (non-fatal):', err.message);
  }
}

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected');
    await fixPhoneIndex();
    autoReconnectIfSessionExists();  // reconnect WA only if a session already exists in MongoDB
    startCron();            // daily expiry check
    startReminderCron();    // scheduled WhatsApp reminders
    startReportCron();      // daily admin report
    startInvoiceCron();     // monthly invoice generation
    app.listen(process.env.PORT || 5000, () =>
      console.log(`SatvikMeals running on port ${process.env.PORT || 5000}`)
    );
  })
  .catch(err => { console.error(err); process.exit(1); });
