'use strict';
/**
 * SatvikMeals — Daily cron job for plan expiry checks
 * Install: npm install node-cron
 * Runs every day at 9:00 AM IST
 * Checks:
 *   1. Plans expiring in exactly 2 days → sends warning email + WA
 *   2. Plans that expired today         → sends expired email + WA, marks status = 'expired'
 */

const User = require('../models/User');
const { sendExpiryWarningEmail, sendPlanExpiredEmail } = require('./resend');
const { sendExpiryWarningWA, sendPlanExpiredWA }       = require('./whatsapp');

function startCron() {
  let cron;
  try {
    cron = require('node-cron');
  } catch (e) {
    console.log('[Cron] node-cron not installed — expiry checks disabled. Run: npm install node-cron');
    return;
  }

  // Run every day at 9:00 AM IST (IST = UTC+5:30, so 3:30 AM UTC)
  cron.schedule('30 3 * * *', runExpiryCheck, { timezone: 'Asia/Kolkata' });
  console.log('[Cron] ✅ Plan expiry check scheduled — runs daily at 9:00 AM IST.');
}

async function runExpiryCheck() {
  console.log(`[Cron] Running plan expiry check at ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

  const now    = new Date();
  // today at midnight IST
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  // 2 days from today (warning window)
  const warnStart = new Date(todayStart);
  warnStart.setDate(warnStart.getDate() + 2);
  const warnEnd   = new Date(todayEnd);
  warnEnd.setDate(warnEnd.getDate() + 2);

  try {
    // ── 1. Plans expiring in 2 days ───────────────────────────────────────────
    const warnUsers = await User.find({
      'subscriptions': {
        $elemMatch: {
          status: 'active',
          endDate: { $gte: warnStart, $lte: warnEnd }
        }
      }
    });

    console.log(`[Cron] Found ${warnUsers.length} user(s) with plans expiring in 2 days.`);

    for (const user of warnUsers) {
      const plan = user.subscriptions.find(
        s => s.status === 'active' && s.endDate >= warnStart && s.endDate <= warnEnd
      );
      if (!plan) continue;
      console.log(`[Cron] Sending expiry warning to ${user.email}`);
      sendExpiryWarningEmail(user, plan).catch(e => console.error('[Cron/Resend] expiry warning email:', e.message));
      sendExpiryWarningWA(user, plan).catch(e => console.error('[Cron/WA] expiry warning WA:', e.message));
    }

    // ── 2. Plans that expired today ───────────────────────────────────────────
    const expiredUsers = await User.find({
      'subscriptions': {
        $elemMatch: {
          status: 'active',
          endDate: { $gte: todayStart, $lte: todayEnd }
        }
      }
    });

    console.log(`[Cron] Found ${expiredUsers.length} user(s) with plans expiring today.`);

    for (const user of expiredUsers) {
      const planIdx = user.subscriptions.findIndex(
        s => s.status === 'active' && s.endDate >= todayStart && s.endDate <= todayEnd
      );
      if (planIdx === -1) continue;

      const plan = user.subscriptions[planIdx];
      console.log(`[Cron] Marking plan expired + sending notifications for ${user.email}`);

      // Mark as expired in DB
      user.subscriptions[planIdx].status = 'expired';
      await user.save();

      // Send notifications
      sendPlanExpiredEmail(user, plan).catch(e => console.error('[Cron/Resend] expired email:', e.message));
      sendPlanExpiredWA(user, plan).catch(e => console.error('[Cron/WA] expired WA:', e.message));
    }

    console.log('[Cron] ✅ Expiry check complete.');
  } catch (err) {
    console.error('[Cron] ❌ Error during expiry check:', err.message);
  }
}

// Export so server.js can start it, and expose runExpiryCheck for manual testing
module.exports = { startCron, runExpiryCheck };
