'use strict';
/**
 * SatvikMeals — Scheduled WhatsApp reminders
 *
 * Two daily reminder jobs, separate from the plan-expiry cron (cron.js):
 *
 *   1. Daily meal reminder — sent to all active subscribers each morning,
 *      reminding them their tiffin is on its way today.
 *   2. Renewal nudge — sent to users whose plan expired 3+ days ago and
 *      have NOT renewed yet (a follow-up beyond the immediate expiry alert).
 *
 * Both run via node-cron and reuse the existing Baileys sender in whatsapp.js.
 */

const User = require('../models/User');
const { sendWA, sendAdminWA } = require('./whatsapp');

function startReminderCron() {
  let cron;
  try {
    cron = require('node-cron');
  } catch (e) {
    console.log('[Reminders] node-cron not installed — scheduled WhatsApp reminders disabled.');
    return;
  }

  // Daily meal reminder — 7:30 AM IST (2:00 AM UTC)
  cron.schedule('0 2 * * *', sendDailyMealReminders, { timezone: 'Asia/Kolkata' });
  console.log('[Reminders] ✅ Daily meal reminder scheduled — runs every day at 7:30 AM IST.');

  // Renewal nudge for lapsed users — 11:00 AM IST (5:30 AM UTC), once a day
  cron.schedule('30 5 * * *', sendRenewalNudges, { timezone: 'Asia/Kolkata' });
  console.log('[Reminders] ✅ Renewal nudge scheduled — runs every day at 11:00 AM IST.');
}

// ── 1. Daily meal reminder for active subscribers ─────────────────────────────
async function sendDailyMealReminders() {
  console.log(`[Reminders] Sending daily meal reminders at ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  try {
    const users = await User.find({ 'subscriptions.status': 'active' }).select('name phone subscriptions');
    let sent = 0, skipped = 0;

    for (const user of users) {
      if (!user.phone) { skipped++; continue; }
      const activeSub = user.subscriptions.find(s => s.status === 'active');
      if (!activeSub) { skipped++; continue; }

      const firstName = user.name?.split(' ')[0] || 'there';
      const text =
        `🌿 *Good morning, ${firstName}!*\n\n` +
        `Your SatvikMeals tiffin (*${activeSub.planName}*) is being prepared and will be delivered today.\n\n` +
        `Need to skip today or have a special request? Just reply here.\n\n` +
        `– Team SatvikMeals 🙏`;

      await sendWA(user.phone, text);
      sent++;
      await new Promise(r => setTimeout(r, 1200)); // gentle pacing to avoid spam flags
    }
    console.log(`[Reminders] ✅ Daily meal reminder complete — sent: ${sent}, skipped: ${skipped}`);
  } catch (err) {
    console.error('[Reminders] ❌ Error sending daily meal reminders:', err.message);
  }
}

// ── 2. Renewal nudge for users who lapsed 3+ days ago and haven't renewed ────
async function sendRenewalNudges() {
  console.log(`[Reminders] Checking renewal nudges at ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  try {
    const now = new Date();
    const threeDaysAgoStart = new Date(now); threeDaysAgoStart.setDate(now.getDate() - 3); threeDaysAgoStart.setHours(0,0,0,0);
    const threeDaysAgoEnd   = new Date(now); threeDaysAgoEnd.setDate(now.getDate() - 3);   threeDaysAgoEnd.setHours(23,59,59,999);

    // Users whose most recent subscription expired exactly 3 days ago and
    // who have no newer active subscription since then.
    const users = await User.find({
      subscriptions: {
        $elemMatch: { status: 'expired', endDate: { $gte: threeDaysAgoStart, $lte: threeDaysAgoEnd } }
      }
    }).select('name phone subscriptions');

    let sent = 0;
    for (const user of users) {
      const hasNewerActive = user.subscriptions.some(s => s.status === 'active');
      if (hasNewerActive || !user.phone) continue;

      const firstName = user.name?.split(' ')[0] || 'there';
      const text =
        `🌿 *We miss you, ${firstName}!*\n\n` +
        `It's been a few days since your SatvikMeals plan ended. Ready to get back to fresh, pure veg meals daily?\n\n` +
        `Just reply here or call us — we'll set you up again in minutes.\n\n` +
        `– Team SatvikMeals 🙏`;

      await sendWA(user.phone, text);
      sent++;
      await new Promise(r => setTimeout(r, 1200));
    }
    console.log(`[Reminders] ✅ Renewal nudge complete — sent: ${sent}`);
  } catch (err) {
    console.error('[Reminders] ❌ Error sending renewal nudges:', err.message);
  }
}

module.exports = { startReminderCron, sendDailyMealReminders, sendRenewalNudges };
