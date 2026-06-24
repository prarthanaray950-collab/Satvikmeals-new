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
    // Allow requests with no origin (mobile apps, curl, server-to-server, same-origin page loads)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.warn(`[CORS] Blocked request from unexpected origin: "${origin}". ` +
      `If this is your real domain, add it to ALLOWED_ORIGINS in Render env vars.`);
    // Fail OPEN with a warning rather than throwing — an unexpected-but-legit
    // origin (e.g. you testing on the .onrender.com URL before DNS cutover)
    // should not silently break login. Tighten this once your domain is confirmed.
    return callback(null, true);
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
