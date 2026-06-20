'use strict';
/**
 * SatvikMeals — WhatsApp sender via Baileys
 * Install: npm install @whiskeysockets/baileys qrcode-terminal
 * Env vars needed:
 *   WA_SESSION_PATH  — folder to persist session, e.g. ./wa-session
 *   ADMIN_WA_NUMBER  — admin's WhatsApp number, 10 digits e.g. 9031447621
 *
 * First run: scan the QR code printed in terminal with the SatvikMeals
 * WhatsApp number. Session is saved and no further scanning is needed.
 */

const path = require('path');
const qrcode = require('qrcode-terminal');

let sock = null;        // Baileys socket instance
let isReady = false;    // true once connection is open
const msgQueue = [];    // queued messages waiting for connection

// ── Connect (call once at server startup) ─────────────────────────────────────
async function connect() {
  if (!process.env.WA_SESSION_PATH) {
    console.log('[WhatsApp] WA_SESSION_PATH not set — WhatsApp sender disabled.');
    return;
  }

  let makeWASocket, useMultiFileAuthState, DisconnectReason, Boom;
  try {
    ({ default: makeWASocket } = await import('@whiskeysockets/baileys'));
    ({ useMultiFileAuthState } = await import('@whiskeysockets/baileys'));
    ({ DisconnectReason } = await import('@whiskeysockets/baileys'));
    ({ Boom } = await import('@hapi/boom'));
  } catch (e) {
    console.error('[WhatsApp] Baileys not installed. Run: npm install @whiskeysockets/baileys qrcode-terminal @hapi/boom');
    return;
  }

  const sessionPath = path.resolve(process.env.WA_SESSION_PATH || './wa-session');
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,   // we handle QR ourselves below
    browser: ['SatvikMeals', 'Chrome', '1.0.0'],
    getMessage: async () => undefined,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n[WhatsApp] Scan this QR code with the SatvikMeals WhatsApp number:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      isReady = true;
      console.log('[WhatsApp] ✅ Connected and ready to send messages.');
      // Flush queued messages
      while (msgQueue.length) {
        const { jid, text } = msgQueue.shift();
        await _send(jid, text).catch(e => console.error('[WhatsApp] Queue flush error:', e.message));
      }
    }

    if (connection === 'close') {
      isReady = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[WhatsApp] Connection closed (code ${statusCode}). Reconnect: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(connect, 5000);   // retry after 5s
      } else {
        console.log('[WhatsApp] Logged out. Delete session folder and restart to re-scan QR.');
      }
    }
  });
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
  if (!process.env.WA_SESSION_PATH) return;
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

module.exports = {
  connect,
  sendWA,
  sendWelcomeWA,
  sendPlanActivatedWA,
  sendExpiryWarningWA,
  sendPlanExpiredWA,
  sendAdminSignupWA,
  sendBroadcastWA,
  sendAdminWA,
};
