'use strict';
/**
 * SatvikMeals — WhatsApp sender via Baileys, with MongoDB-persisted session.
 *
 * Unlike the old file-based version, this:
 *   1. Stores the WhatsApp session in MongoDB (survives Render restarts).
 *   2. Does NOT force a fresh QR scan on every restart — if a session
 *      already exists in MongoDB, the server reconnects automatically.
 *   3. Lets the admin start a brand-new connection (and scan a QR shown
 *      directly in the admin panel) or disconnect/wipe the session,
 *      entirely from the browser — no server console access needed.
 *
 * Install: npm install @whiskeysockets/baileys @hapi/boom qrcode
 */

const { useMongoAuthState } = require('./waAuthState');
const WaSession = require('../models/WaSession');

let sock = null;          // Baileys socket instance
let isReady = false;      // true once connection is open
let isConnecting = false; // true while a connect() call is in progress
let lastQr = null;        // most recent QR string (raw, for re-encoding to image)
let lastStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_pending' | 'connected'
let lastError = null;
let reconnectTimer = null; // tracks pending reconnect so disconnect() can cancel it
const msgQueue = [];      // queued messages waiting for connection

// ── Public status (used by admin API) ─────────────────────────────────────────
function getStatus() {
  return { status: lastStatus, hasQr: !!lastQr, error: lastError, queueLength: msgQueue.length };
}

// ── Get current QR as a data:image/png base64 string (or null) ───────────────
async function getQrImage() {
  if (!lastQr) return null;
  let QRCode;
  try {
    QRCode = require('qrcode');
  } catch (e) {
    console.error('[WhatsApp] qrcode package not installed. Run: npm install qrcode');
    return null;
  }
  try {
    return await QRCode.toDataURL(lastQr, { width: 280, margin: 1 });
  } catch (e) {
    console.error('[WhatsApp] Failed to render QR image:', e.message);
    return null;
  }
}

// ── Connect — called by admin clicking "Connect WhatsApp" ────────────────────
async function connect() {
  // Cancel any pending auto-reconnect timer
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (isConnecting || isReady) {
    return getStatus();
  }
  isConnecting = true;
  lastStatus = 'connecting';
  lastError = null;

  let makeWASocket, DisconnectReason;
  try {
    ({ default: makeWASocket } = await import('@whiskeysockets/baileys'));
    ({ DisconnectReason } = await import('@whiskeysockets/baileys'));
  } catch (e) {
    console.error('[WhatsApp] Baileys not installed. Run: npm install @whiskeysockets/baileys @hapi/boom qrcode');
    isConnecting = false;
    lastStatus = 'disconnected';
    lastError = 'Baileys package not installed on server.';
    return getStatus();
  }

  try {
    const { state, saveCreds } = await useMongoAuthState();

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['SatvikMeals', 'Chrome', '1.0.0'],
      getMessage: async () => undefined,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        lastQr = qr;
        lastStatus = 'qr_pending';
        console.log('[WhatsApp] QR code ready — scan from the admin panel (WhatsApp tab).');
      }

      if (connection === 'open') {
        isReady = true;
        isConnecting = false;
        lastQr = null;
        lastStatus = 'connected';
        lastError = null;
        console.log('[WhatsApp] ✅ Connected and ready to send messages.');
        while (msgQueue.length) {
          const { jid, text } = msgQueue.shift();
          await _send(jid, text).catch(e => console.error('[WhatsApp] Queue flush error:', e.message));
        }
      }

      if (connection === 'close') {
        isReady = false;
        isConnecting = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        console.log(`[WhatsApp] Connection closed (code ${statusCode}). Logged out: ${loggedOut}`);

        if (loggedOut) {
          lastStatus = 'disconnected';
          lastQr = null;
          await WaSession.deleteMany({}).catch(() => {});
          console.log('[WhatsApp] Logged out from phone. Session cleared — admin must reconnect with a new QR.');
        } else {
          lastStatus = 'connecting';
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 5000);
        }
      }
    });

    return getStatus();
  } catch (err) {
    console.error('[WhatsApp] Connect error:', err.message);
    isConnecting = false;
    lastStatus = 'disconnected';
    lastError = err.message;
    return getStatus();
  }
}

// ── Disconnect — called by admin clicking "Disconnect WhatsApp" ──────────────
async function disconnect() {
  // Cancel any pending reconnect timer so it doesn't restart after we clear
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  // Force-reset state immediately so connect() won't return early
  isReady = false;
  isConnecting = false;
  try {
    if (sock) {
      try { sock.ev.removeAllListeners(); await sock.end(); } catch (e) { /* ignore */ }
      sock = null;
    }
  } catch (e) { /* ignore */ }
  lastQr = null;
  lastStatus = 'disconnected';
  lastError = null;
  await WaSession.deleteMany({});
  console.log('[WhatsApp] Session disconnected and cleared from MongoDB by admin.');
  return getStatus();
}

// ── Internal send ─────────────────────────────────────────────────────────────
async function _send(jid, text) {
  if (!sock) return;
  await sock.sendMessage(jid, { text });
}

// ── Format number to WhatsApp JID ─────────────────────────────────────────────
function toJid(phone) {
  const cleaned = phone.toString().replace(/\D/g, '');
  // If already has country code (starts with 91 and is 12 digits)
  const num = cleaned.length === 12 && cleaned.startsWith('91') ? cleaned : '91' + cleaned;
  return `${num}@s.whatsapp.net`;
}

// ── Safe public send — queues if not yet connected ────────────────────────────
async function sendWA(phone, text) {
  if (!phone) { console.log('[WhatsApp] No phone — skipping message.'); return; }
  const jid = toJid(phone);
  try {
    if (isReady) {
      await _send(jid, text);
      console.log(`[WhatsApp] ✅ Sent to ${phone}`);
    } else {
      msgQueue.push({ jid, text });
      console.log(`[WhatsApp] Queued message for ${phone} (not connected yet).`);
    }
  } catch (err) {
    console.error(`[WhatsApp] Failed to send to ${phone}:`, err.message);
  }
}

// ── Admin shortcut ────────────────────────────────────────────────────────────
async function sendAdminWA(text) {
  const adminNum = process.env.ADMIN_WA_NUMBER;
  if (!adminNum) return;
  await sendWA(adminNum, text);
}

// ── 1. Welcome message to new user ───────────────────────────────────────────
async function sendWelcomeWA(user) {
  if (!user.phone) return;
  const firstName = user.name?.split(' ')[0] || 'there';
  const text =
    `🌿 *Welcome to SatvikMeals, ${firstName}!*\n\n` +
    `We're so happy to have you 😊\n\n` +
    `Here's what we offer:\n` +
    `✅ 100% Pure Vegetarian kitchen\n` +
    `🕉️ Jain & Satvik meals available\n` +
    `🧅 No Onion-Garlic options (cooked separately)\n` +
    `⚡ Instant delivery + daily tiffin subscriptions\n` +
    `📍 Serving all areas of Patna\n\n` +
    `To confirm a plan, just reply here or call us.\n\n` +
    `👉 View our plans: https://satvikmeals.in/plans.html\n\n` +
    `– Team SatvikMeals`;
  await sendWA(user.phone, text);
}

// ── 2. Plan activated message to user ────────────────────────────────────────
async function sendPlanActivatedWA(user, plan) {
  if (!user.phone) return;
  const startDate = new Date(plan.startDate).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });
  const endDate   = new Date(plan.endDate).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });
  const firstName = user.name?.split(' ')[0] || 'there';
  const text =
    `✅ *Plan Activated — SatvikMeals*\n\n` +
    `Hi ${firstName}, your subscription is now active!\n\n` +
    `📋 *Plan:* ${plan.planName}\n` +
    `📅 *Start:* ${startDate}\n` +
    `📅 *Expires:* ${endDate}\n` +
    `📍 *Delivery Area:* ${user.location?.address?.split(',').slice(0,2).join(',') || 'Your saved location'}\n\n` +
    `Your meals will be delivered daily. If you need to pause or have any questions, just reply here.\n\n` +
    `– Team SatvikMeals 🌿`;
  await sendWA(user.phone, text);
  // Also notify admin
  await sendAdminWA(
    `✅ *Plan Assigned*\n\n` +
    `👤 ${user.name} (${user.email})\n` +
    `📱 ${user.phone}\n` +
    `📋 Plan: ${plan.planName}\n` +
    `📅 Expires: ${endDate}`
  );
}

// ── 3. Expiry warning (2 days before) ────────────────────────────────────────
async function sendExpiryWarningWA(user, plan) {
  if (!user.phone) return;
  const endDate = new Date(plan.endDate).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });
  const firstName = user.name?.split(' ')[0] || 'there';
  const text =
    `⏰ *Plan Expiring Soon — SatvikMeals*\n\n` +
    `Hi ${firstName}, your *${plan.planName}* plan expires on *${endDate}*.\n\n` +
    `To continue receiving your daily meals without a break, please renew now.\n\n` +
    `Reply here or call us to renew — it only takes a minute!\n\n` +
    `– Team SatvikMeals 🌿`;
  await sendWA(user.phone, text);
}

// ── 4. Plan expired ───────────────────────────────────────────────────────────
async function sendPlanExpiredWA(user, plan) {
  if (!user.phone) return;
  const firstName = user.name?.split(' ')[0] || 'there';
  const text =
    `📋 *Plan Expired — SatvikMeals*\n\n` +
    `Hi ${firstName}, your *${plan.planName}* subscription has ended.\n\n` +
    `We hope you enjoyed your SatvikMeals experience! 😊\n\n` +
    `To renew and continue getting fresh, pure veg meals daily — just reply here or call us.\n\n` +
    `– Team SatvikMeals 🌿`;
  await sendWA(user.phone, text);
}

// ── 5. Admin new-signup alert ─────────────────────────────────────────────────
async function sendAdminSignupWA(user) {
  const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  await sendAdminWA(
    `🎉 *New Signup — SatvikMeals*\n\n` +
    `👤 Name: ${user.name}\n` +
    `📧 Email: ${user.email}\n` +
    `📱 Phone: ${user.phone ? '+91 ' + user.phone : 'Not added yet'}\n` +
    `🗓 Time: ${time}\n` +
    `🔗 Ref: ${user.referredBy || 'Direct'}`
  );
}

// ── 6. Broadcast to list of users ─────────────────────────────────────────────
async function sendBroadcastWA(users, message) {
  let sent = 0, skipped = 0;
  for (const user of users) {
    if (!user.phone) { skipped++; continue; }
    await sendWA(user.phone, message);
    sent++;
    // Delay to avoid spam detection
    await new Promise(r => setTimeout(r, 1500));
  }
  console.log(`[WhatsApp] Broadcast done — sent: ${sent}, skipped (no phone): ${skipped}`);
  return { sent, skipped };
}

// ── Auto-reconnect at server startup IF a session already exists in Mongo ────
// After the first QR scan, future Render restarts reconnect silently using
// the saved Mongo session — no QR needed again unless the admin explicitly
// disconnects or the phone itself logs the session out.
async function autoReconnectIfSessionExists() {
  try {
    const hasCreds = await WaSession.findOne({ category: 'creds' }).lean();
    if (hasCreds) {
      console.log('[WhatsApp] Existing session found in MongoDB — reconnecting automatically.');
      await connect();
    } else {
      console.log('[WhatsApp] No existing session in MongoDB — waiting for admin to connect via admin panel.');
    }
  } catch (err) {
    console.error('[WhatsApp] autoReconnectIfSessionExists error:', err.message);
  }
}

module.exports = {
  connect,
  disconnect,
  getStatus,
  getQrImage,
  autoReconnectIfSessionExists,
  sendWA,
  sendWelcomeWA,
  sendPlanActivatedWA,
  sendExpiryWarningWA,
  sendPlanExpiredWA,
  sendAdminSignupWA,
  sendBroadcastWA,
  sendAdminWA,
};
