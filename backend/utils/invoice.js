'use strict';
/**
 * SatvikMeals — Monthly invoice generation
 *
 * Runs on the 1st of every month at 8:00 AM IST. For every user with at
 * least one subscription active during the previous month, generates a
 * simple HTML invoice and emails it via Resend. No PDF library dependency —
 * the invoice is a clean, printable HTML email (works in all clients and
 * can be "Printed to PDF" by the user if needed).
 *
 * To manually trigger (for testing), call generateMonthlyInvoices() directly.
 */

const User = require('../models/User');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.RESEND_FROM || 'SatvikMeals <hello@satvikmeals.in>';

function startInvoiceCron() {
  let cron;
  try {
    cron = require('node-cron');
  } catch (e) {
    console.log('[Invoice] node-cron not installed — monthly invoices disabled.');
    return;
  }
  // 1st of every month, 8:00 AM IST (2:30 AM UTC)
  cron.schedule('30 2 1 * *', generateMonthlyInvoices, { timezone: 'Asia/Kolkata' });
  console.log('[Invoice] ✅ Monthly invoice generation scheduled — runs on the 1st of every month, 8 AM IST.');
}

function formatINR(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN');
}

function invoiceHtml({ user, lineItems, total, periodLabel, invoiceNo }) {
  const rows = lineItems.map(li => `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #EBEBEB;font-size:13px;color:#374151;">${li.desc}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #EBEBEB;font-size:13px;color:#374151;text-align:center;">${li.qty}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #EBEBEB;font-size:13px;color:#374151;text-align:right;">${formatINR(li.amount)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F5F5F0;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F0;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">
  <tr><td style="background:linear-gradient(135deg,#1B4332,#40916C);padding:28px 36px;">
    <table width="100%"><tr>
      <td style="color:#fff;font-size:20px;font-weight:700;">🌿 SatvikMeals</td>
      <td style="color:rgba(255,255,255,0.8);font-size:13px;text-align:right;">Invoice #${invoiceNo}</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px 36px;">
    <h2 style="margin:0 0 4px;font-size:20px;color:#0F2D1F;">Monthly Invoice</h2>
    <p style="margin:0 0 24px;font-size:13px;color:#6B7280;">Billing period: ${periodLabel}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr><td style="font-size:13px;color:#6B7280;padding:4px 0;">Billed to:</td></tr>
      <tr><td style="font-size:14px;font-weight:600;color:#1B4332;padding:2px 0;">${user.name}</td></tr>
      <tr><td style="font-size:13px;color:#374151;padding:2px 0;">${user.email}</td></tr>
      <tr><td style="font-size:13px;color:#374151;padding:2px 0;">${user.phone ? '+91 ' + user.phone : ''}</td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:8px;">
      <tr style="background:#F6FBF7;">
        <td style="padding:10px 8px;font-size:12px;font-weight:700;color:#1B4332;">DESCRIPTION</td>
        <td style="padding:10px 8px;font-size:12px;font-weight:700;color:#1B4332;text-align:center;">QTY</td>
        <td style="padding:10px 8px;font-size:12px;font-weight:700;color:#1B4332;text-align:right;">AMOUNT</td>
      </tr>
      ${rows}
      <tr>
        <td colspan="2" style="padding:14px 8px;font-size:14px;font-weight:700;color:#0F2D1F;text-align:right;">Total</td>
        <td style="padding:14px 8px;font-size:16px;font-weight:700;color:#1B4332;text-align:right;">${formatINR(total)}</td>
      </tr>
    </table>
    <p style="margin:20px 0 0;font-size:12px;color:#9A9A8E;">This is a system-generated invoice for your SatvikMeals subscription. For any billing questions, WhatsApp us at +91 90314 47621.</p>
  </td></tr>
  <tr><td style="background:#F9F9F7;border-top:1px solid #EBEBEB;padding:18px 36px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9A9A8E;">SatvikMeals, Patna, Bihar · <a href="https://satvikmeals.in" style="color:#40916C;">satvikmeals.in</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

async function generateMonthlyInvoices() {
  console.log(`[Invoice] Running monthly invoice generation at ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

  const now = new Date();
  // Previous month's date range
  const periodEnd   = new Date(now.getFullYear(), now.getMonth(), 1); // 1st of this month
  const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1); // 1st of last month
  const periodLabel = periodStart.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  if (!process.env.RESEND_API_KEY) {
    console.log('[Invoice] RESEND_API_KEY not set — skipping invoice emails.');
    return;
  }

  try {
    // Users with any subscription that overlapped last month
    const users = await User.find({
      'subscriptions': {
        $elemMatch: {
          startDate: { $lt: periodEnd },
          endDate:   { $gte: periodStart }
        }
      }
    });

    console.log(`[Invoice] Found ${users.length} user(s) with subscriptions in ${periodLabel}.`);

    let sent = 0, skipped = 0;
    for (const user of users) {
      const relevantSubs = user.subscriptions.filter(
        s => s.startDate < periodEnd && s.endDate >= periodStart
      );
      if (!relevantSubs.length) { skipped++; continue; }

      // Note: this app does not store per-plan price on the subscription
      // sub-document, so amount is shown as "—" unless a price was recorded.
      // If you want exact billing amounts, add a `price` field when assigning
      // the plan in admin.js (assign-plan route) and it will show up here.
      const lineItems = relevantSubs.map(s => ({
        desc: `${s.planName} (${new Date(s.startDate).toLocaleDateString('en-IN')} – ${new Date(s.endDate).toLocaleDateString('en-IN')})`,
        qty: 1,
        amount: s.price || 0
      }));
      const total = lineItems.reduce((sum, li) => sum + li.amount, 0);
      const invoiceNo = `SM-${periodStart.getFullYear()}${String(periodStart.getMonth()+1).padStart(2,'0')}-${user._id.toString().slice(-6).toUpperCase()}`;

      try {
        await resend.emails.send({
          from: FROM,
          to: user.email,
          subject: `Your SatvikMeals Invoice — ${periodLabel}`,
          html: invoiceHtml({ user, lineItems, total, periodLabel, invoiceNo })
        });
        sent++;
        console.log(`[Invoice] Sent invoice to ${user.email}`);
      } catch (err) {
        console.error(`[Invoice] Failed to send invoice to ${user.email}:`, err.message);
        skipped++;
      }
      await new Promise(r => setTimeout(r, 150)); // gentle rate limiting
    }

    console.log(`[Invoice] ✅ Monthly invoice run complete — sent: ${sent}, skipped: ${skipped}`);
  } catch (err) {
    console.error('[Invoice] ❌ Error during invoice generation:', err.message);
  }
}

module.exports = { startInvoiceCron, generateMonthlyInvoices };
