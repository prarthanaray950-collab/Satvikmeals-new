const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt  = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { sendTelegramMessage } = require('../utils/telegram');
const router = express.Router();

const signToken = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// ── GOOGLE AUTH ───────────────────────────────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { idToken, referralCode } = req.body;
    if (!idToken) return res.status(400).json({ message: 'ID token required.' });

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const client = new OAuth2Client(clientId);
    let payload;

    try {
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      try {
        const ticket2 = await client.verifyIdToken({ idToken });
        payload = ticket2.getPayload();
      } catch (err2) {
        return res.status(401).json({ message: 'Google login failed. Please try again.' });
      }
    }

    const { sub: googleId, email, name } = payload;
    if (!email) return res.status(400).json({ message: 'Could not get email from Google.' });

    let user = await User.findOne({ email: email.toLowerCase() });
    const isNewUser = !user;

    if (!user) {
      user = await User.create({ googleId, email: email.toLowerCase(), name, referredBy: referralCode || null });
      if (referralCode) {
        await User.findOneAndUpdate(
          { referralCode },
          { $push: { referredUsers: { email: email.toLowerCase(), name, joinedAt: new Date() } } }
        );
      }
    } else {
      if (!user.googleId) { user.googleId = googleId; await user.save(); }
    }

    const token = signToken(user._id);
    res.json({
      token, isNewUser,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, referralCode: user.referralCode, coins: user.coins }
    });
  } catch (err) {
    console.error('[Google Auth] Error:', err.message);
    res.status(500).json({ message: 'Login failed. Please try again.' });
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

router.patch('/phone', protect, savePhone);
router.post('/save-phone', protect, savePhone);

// ── SAVE LOCATION ─────────────────────────────────────────────────────────────
router.post('/location', protect, async (req, res) => {
  try {
    const { latitude, longitude, address } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ message: 'lat/lng required.' });

    await User.findByIdAndUpdate(req.user._id, {
      $set: { location: { latitude, longitude, address: address || '', capturedAt: new Date() } }
    });

    const mapsLink = `https://maps.google.com/?q=${latitude},${longitude}`;
    await sendTelegramMessage(
      `📍 NEW USER SIGNUP\n\n` +
      `👤 Name: ${req.user.name}\n` +
      `📧 Email: ${req.user.email}\n` +
      `📱 Phone: ${req.user.phone || 'Not added yet'}\n` +
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
      user = await User.create({ name: name.trim(), email: emailLower, referredBy: referralCode || null });
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
