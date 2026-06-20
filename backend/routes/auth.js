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
      console.log(`[createUser] Attempt ${i + 1} for email: ${data.email}`);
      const user = await User.create(data);
      console.log(`[createUser] Success on attempt ${i + 1}, userId: ${user._id}`);
      return user;
    } catch (err) {
      console.error(`[createUser] Attempt ${i + 1} failed — code: ${err.code}, message: ${err.message}`);
      console.error(`[createUser] keyPattern: ${JSON.stringify(err.keyPattern)}`);
      // E11000 = MongoDB duplicate key error
      if (err.code === 11000 && err.keyPattern?.referralCode && i < attempts - 1) {
        console.log(`[createUser] referralCode collision detected, retrying...`);
        continue;
      }
      throw err;
    }
  }
}

// ── GOOGLE REDIRECT CALLBACK (ux_mode: 'redirect') ───────────────────────────
// Google POSTs credential here as form body after account picker
// Also exported directly so server.js can mount it before CORS middleware
const googleCallback = async (req, res) => {
  try {
    const credential = req.body.credential;
    if (!credential) return res.redirect('/login.html?error=no_credential');

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const client = new OAuth2Client(clientId);
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
      payload = ticket.getPayload();
    } catch (e) {
      return res.redirect('/login.html?error=invalid_token');
    }

    const { sub: googleId, email, name } = payload;
    if (!email) return res.redirect('/login.html?error=no_email');

    let user = await User.findOne({ email: email.toLowerCase() });
    const isNewUser = !user;

    if (!user) {
      user = await createUserWithRetry({ googleId, email: email.toLowerCase(), name });
      sendWelcomeEmail(user).catch(() => {});
      sendAdminSignupAlert(user).catch(() => {});
      sendWelcomeWA(user).catch(() => {});
      sendAdminSignupWA(user).catch(() => {});
    } else if (!user.googleId) {
      user.googleId = googleId;
      await user.save();
    }

    const token = signToken(user._id);
    const userPayload = encodeURIComponent(JSON.stringify({
      id: user._id, name: user.name, email: user.email,
      phone: user.phone, role: user.role, referralCode: user.referralCode, coins: user.coins
    }));

    res.redirect(`/login.html?gtoken=${token}&guser=${userPayload}&newUser=${isNewUser}`);
  } catch (err) {
    console.error('[Google Callback]', err.message);
    res.redirect('/login.html?error=server_error');
  }
});

// ── GOOGLE AUTH ───────────────────────────────────────────────────────────────
// mounted separately in server.js before CORS
router.post('/google/callback', googleCallback);

router.post('/google', async (req, res) => {
  const step = { current: 'start' };
  try {
    const { idToken, referralCode } = req.body;
    console.log(`[Google Auth] Request received. referralCode: ${referralCode || 'none'}`);

    if (!idToken) return res.status(400).json({ message: 'ID token required.' });

    const clientId = process.env.GOOGLE_CLIENT_ID;
    console.log(`[Google Auth] GOOGLE_CLIENT_ID present: ${!!clientId}`);

    step.current = 'verifyToken';
    const client = new OAuth2Client(clientId);
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload();
      console.log(`[Google Auth] Token verified. email: ${payload.email}`);
    } catch (verifyErr) {
      console.error('[Google Auth] Token verification failed:', verifyErr.message);
      return res.status(401).json({ message: 'Google login failed. Please try again.' });
    }

    const { sub: googleId, email, name } = payload;
    if (!email) return res.status(400).json({ message: 'Could not get email from Google.' });

    step.current = 'findUser';
    console.log(`[Google Auth] Looking up user: ${email.toLowerCase()}`);
    let user = await User.findOne({ email: email.toLowerCase() });
    const isNewUser = !user;
    console.log(`[Google Auth] isNewUser: ${isNewUser}`);

    if (!user) {
      step.current = 'createUser';
      console.log(`[Google Auth] Creating new user for: ${email.toLowerCase()}`);
      user = await createUserWithRetry({
        googleId,
        email: email.toLowerCase(),
        name,
        referredBy: referralCode || null
      });
      console.log(`[Google Auth] New user created: ${user._id}`);

      // Fire welcome email to user + admin alert — non-blocking
      sendWelcomeEmail(user).catch(e => console.error('[Resend] welcome email failed:', e.message));
      sendAdminSignupAlert(user).catch(e => console.error('[Resend] admin alert failed:', e.message));
      sendWelcomeWA(user).catch(e => console.error('[WhatsApp] welcome WA failed:', e.message));
      sendAdminSignupWA(user).catch(e => console.error('[WhatsApp] admin signup WA failed:', e.message));

      if (referralCode) {
        step.current = 'applyReferral';
        console.log(`[Google Auth] Applying referral code: ${referralCode}`);
        await User.findOneAndUpdate(
          { referralCode },
          { $push: { referredUsers: { email: email.toLowerCase(), name, joinedAt: new Date() } } }
        );
        console.log(`[Google Auth] Referral applied.`);
      }
    } else {
      if (!user.googleId) {
        step.current = 'linkGoogleId';
        console.log(`[Google Auth] Linking googleId to existing user: ${user._id}`);
        user.googleId = googleId;
        await user.save();
      }
    }

    step.current = 'signToken';
    const token = signToken(user._id);
    console.log(`[Google Auth] Login successful for: ${email}`);

    res.json({
      token, isNewUser,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, referralCode: user.referralCode, coins: user.coins }
    });
  } catch (err) {
    console.error(`[Google Auth] FATAL at step: "${step.current}"`);
    console.error(`[Google Auth] Error name: ${err.name}`);
    console.error(`[Google Auth] Error message: ${err.message}`);
    console.error(`[Google Auth] Error code: ${err.code}`);
    console.error(`[Google Auth] keyPattern: ${JSON.stringify(err.keyPattern)}`);
    console.error(`[Google Auth] keyValue: ${JSON.stringify(err.keyValue)}`);
    console.error(`[Google Auth] Stack: ${err.stack}`);
    // Temporarily returns the real error so you can see it in the browser network tab
    res.status(500).json({ message: `[${step.current}] ${err.message}` });
  }
});

// ── GET ME ────────────────────────────────────────────────────────────────────
router.get('/me', protect, (req, res) => {
  const u = req.user;
  res.json({ id: u._id, name: u.name, email: u.email, phone: u.phone, role: u.role, referralCode: u.referralCode, coins: u.coins, subscriptions: u.subscriptions });
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
    res.json({ success: true, message: 'Phone saved.', phone: result.phone });
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

    const mapsLink = `https://maps.google.com/?q=${latitude},${longitude}`;

    // Refresh user to get latest phone (may have been added in phone modal)
    const freshUser = await User.findById(req.user._id);

    await sendTelegramMessage(
      `📍 NEW USER SIGNUP\n\n` +
      `👤 Name: ${freshUser.name}\n` +
      `📧 Email: ${freshUser.email}\n` +
      `📱 Phone: ${freshUser.phone || 'Not added yet'}\n` +
      `🗓 Joined: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\n` +
      `📌 Location: ${address || 'Unknown'}\n` +
      `🗺 Maps: ${mapsLink}`
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[Location Save]', err.message);
    res.status(500).json({ message: 'Failed to save location.' });
  }
});

// ── DEV LOGIN ─────────────────────────────────────────────────────────────────
router.post('/dev-login', async (req, res) => {
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
module.exports.googleCallback = googleCallback;
