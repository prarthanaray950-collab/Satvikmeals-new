const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt  = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { verifyToken: csrfVerify } = require('../middleware/csrf');
const { sendTelegramMessage } = require('../utils/telegram');
const { sendWelcomeEmail, sendAdminSignupAlert } = require('../utils/resend');
const { sendWelcomeWA, sendAdminSignupWA }       = require('../utils/whatsapp');
const router = express.Router();

const signToken = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// Creates a new user, retrying up to 5 times if referralCode collides
async function createUserWithRetry(data, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await User.create(data);
    } catch (err) {
      // E11000 = MongoDB duplicate key error
      if (err.code === 11000 && err.keyPattern?.referralCode && i < attempts - 1) {
        console.log(`[createUser] referralCode collision on attempt ${i + 1}, retrying…`);
        continue;
      }
      throw err;
    }
  }
}

// ── GOOGLE AUTH ───────────────────────────────────────────────────────────────
router.post('/google', async (req, res) => {
  const step = { current: 'start' };
  try {
    const { idToken, referralCode } = req.body;

    if (!idToken) return res.status(400).json({ message: 'ID token required.' });

    const clientId = process.env.GOOGLE_CLIENT_ID;

    step.current = 'verifyToken';
    const client = new OAuth2Client(clientId);
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      console.error('[Google Auth] Token verification failed:', verifyErr.message);
      return res.status(401).json({ message: 'Google login failed. Please try again.' });
    }

    const { sub: googleId, email, name } = payload;
    if (!email) return res.status(400).json({ message: 'Could not get email from Google.' });

    step.current = 'findUser';
    let user = await User.findOne({ email: email.toLowerCase() });
    const isNewUser = !user;

    if (!user) {
      step.current = 'createUser';
      user = await createUserWithRetry({
        googleId,
        email: email.toLowerCase(),
        name,
        referredBy: referralCode || null
      });
      // NOTE: Welcome email/WhatsApp + admin alerts now fire from the
      // /location route below, once onboarding (phone + location) is
      // actually complete — not here, where phone/location don't exist yet.

      if (referralCode) {
        step.current = 'applyReferral';
        await User.findOneAndUpdate(
          { referralCode },
          { $push: { referredUsers: { email: email.toLowerCase(), name, joinedAt: new Date() } } }
        );
      }
    } else {
      if (!user.googleId) {
        step.current = 'linkGoogleId';
        user.googleId = googleId;
        await user.save();
      }
    }

    step.current = 'signToken';
    const token = signToken(user._id);

    res.json({
      token, isNewUser,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, referralCode: user.referralCode, coins: user.coins, location: user.location }
    });
  } catch (err) {
    // Log full detail server-side only (kept out of the HTTP response).
    console.error(`[Google Auth] FATAL at step "${step.current}": ${err.name}: ${err.message}`);
    if (err.code) console.error(`[Google Auth] code: ${err.code}`);
    // Never leak internal error text / PII to the browser — return a generic message.
    res.status(500).json({ message: 'Login failed. Please try again in a moment.' });
  }
});

// ── GET ME ────────────────────────────────────────────────────────────────────
router.get('/me', protect, (req, res) => {
  const u = req.user;
  res.json({ id: u._id, name: u.name, email: u.email, phone: u.phone, role: u.role, referralCode: u.referralCode, coins: u.coins, subscriptions: u.subscriptions, location: u.location });
});

// ── SAVE PHONE ────────────────────────────────────────────────────────────────
async function savePhone(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: 'Phone required.' });
    const cleaned = phone.toString().replace(/\D/g, '');
    if (cleaned.length !== 10 || !/^[6-9]/.test(cleaned))
      return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number.' });
    const result = await User.findByIdAndUpdate(req.user._id, { $set: { phone: cleaned } }, { new: true });
    res.json({ success: true, message: 'Phone saved.', phone: result.phone, user: { id: result._id, name: result.name, email: result.email, phone: result.phone, role: result.role, location: result.location } });
  } catch (err) {
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
}

router.patch('/phone', protect, csrfVerify, savePhone);
router.post('/save-phone', protect, csrfVerify, savePhone);

// ── SAVE LOCATION ─────────────────────────────────────────────────────────────
router.post('/location', protect, csrfVerify, async (req, res) => {
  try {
    const { latitude, longitude, address } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ message: 'lat/lng required.' });

    await User.findByIdAndUpdate(req.user._id, {
      $set: { location: { latitude, longitude, address: address || '', capturedAt: new Date() } }
    });

    // Respond immediately — the client only needs to know the location saved.
    // Telegram alert + welcome email/WhatsApp are best-effort side-effects that
    // must not hold the HTTP request open (Telegram/Resend/Baileys can each take
    // several seconds or hang). Fire them after responding.
    res.json({ success: true });

    // ── Non-blocking post-save notifications ──────────────────────────────────
    ;(async () => {
      try {
        const mapsLink = `https://maps.google.com/?q=${latitude},${longitude}`;
        // Refresh user to get latest phone + location (onboarding is now complete)
        const freshUser = await User.findById(req.user._id);
        if (!freshUser) return;

        sendTelegramMessage(
          `📍 NEW USER SIGNUP\n\n` +
          `👤 Name: ${freshUser.name}\n` +
          `📧 Email: ${freshUser.email}\n` +
          `📱 Phone: ${freshUser.phone || 'Not added yet'}\n` +
          `🗓 Joined: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\n` +
          `📌 Location: ${address || 'Unknown'}\n` +
          `🗺 Maps: ${mapsLink}`
        ).catch(e => console.error('[Telegram] location alert failed:', e.message));

        // Onboarding (phone + location) is complete — the real signal to welcome
        // the user. Only fire once: guarded by welcomeSentAt. Use an atomic guard
        // (update only if not already set) so concurrent /location calls can't
        // double-send.
        if (!freshUser.welcomeSentAt) {
          const claimed = await User.findOneAndUpdate(
            { _id: freshUser._id, welcomeSentAt: { $in: [null, undefined] } },
            { $set: { welcomeSentAt: new Date() } }
          );
          if (claimed) {
            sendWelcomeEmail(freshUser).catch(e => console.error('[Resend] welcome email failed:', e.message));
            sendAdminSignupAlert(freshUser).catch(e => console.error('[Resend] admin alert failed:', e.message));
            sendWelcomeWA(freshUser).catch(e => console.error('[WhatsApp] welcome WA failed:', e.message));
            sendAdminSignupWA(freshUser).catch(e => console.error('[WhatsApp] admin signup WA failed:', e.message));
          }
        }
      } catch (e) {
        console.error('[Location Save] post-response side-effect error:', e.message);
      }
    })();
  } catch (err) {
    console.error('[Location Save]', err.message);
    if (!res.headersSent) res.status(500).json({ message: 'Failed to save location.' });
  }
});

// ── DEV LOGIN ─────────────────────────────────────────────────────────────────
// SECURITY: this endpoint mints a valid JWT for ANY email with no verification —
// including an admin email — so it is a full account-takeover hole if reachable
// in production. It is now hard-disabled unless BOTH conditions hold:
//   1. NODE_ENV !== 'production'
//   2. ENABLE_DEV_LOGIN === 'true'   (explicit opt-in, even in dev)
// In production it always returns 404 (indistinguishable from "route not found")
// so it cannot be probed. Never set ENABLE_DEV_LOGIN=true on Render.
const DEV_LOGIN_ENABLED =
  process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_LOGIN === 'true';

router.post('/dev-login', async (req, res) => {
  if (!DEV_LOGIN_ENABLED) {
    return res.status(404).json({ message: 'Not found.' });
  }
  try {
    const { name, email, referralCode } = req.body;
    if (!name || !email) return res.status(400).json({ message: 'Name and email required.' });
    const emailLower = email.toLowerCase().trim();
    let user = await User.findOne({ email: emailLower });
    if (!user) {
      user = await createUserWithRetry({ name: name.trim(), email: emailLower, referredBy: referralCode || null });
      if (referralCode) {
        await User.findOneAndUpdate({ referralCode }, { $push: { referredUsers: { email: emailLower, name, joinedAt: new Date() } } });
      }
    }
    const token = signToken(user._id);
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, referralCode: user.referralCode, coins: user.coins } });
  } catch (err) {
    res.status(500).json({ message: 'Login failed: ' + err.message });
  }
});

module.exports = router;
