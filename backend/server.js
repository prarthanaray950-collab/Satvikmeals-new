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
}));

// ── CORS — restrict to known origins instead of wildcard ─────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://satvikmeals.in,https://www.satvikmeals.in,http://localhost:3000,http://localhost:5000')
  .split(',').map(o => o.trim());

// Body parsers must come first so Google callback can read req.body
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

// Google OAuth callback: POSTed by accounts.google.com — must skip CORS entirely
app.post('/api/auth/google/callback', require('./routes/auth').googleCallback);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    console.warn(`[CORS] Blocked request from origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

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
