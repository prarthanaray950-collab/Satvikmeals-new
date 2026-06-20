'use strict';
/**
 * SatvikMeals — Daily admin report
 *
 * Every night at 9:00 PM IST, sends the admin a summary email + WhatsApp
 * covering: new signups today, active subscribers, plans expiring soon,
 * plans expired today, and total users — so the admin always has a
 * end-of-day snapshot without opening the admin panel.
 */

const User = require('../models/User');
const { Resend } = require('resend');
const { sendAdminWA } = require('./whatsapp');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.RESEND_FROM || 'SatvikMeals <hello@satvikmeals.in>';

function startReportCron() {
  let cron;
  try {
    cron = require('node-cron');
  } catch (e) {
    console.log('[DailyReport] node-cron not installed — daily reports disabled.');
    return;
  }
  // 9:00 PM IST = 3:30 PM UTC
  cron.schedule('30 15 * * *', sendDailyReport, { timezone: 'Asia/Kolkata' });
  console.log('[DailyReport] ✅ Daily admin report scheduled — runs every day at 9:00 PM IST.');
}

async function buildStats() {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
  const todayEnd   = new Date(now); todayEnd.setHours(23,59,59,999);
  const in3days    = new Date(todayEnd); in3days.setDate(in3days.getDate() + 3);

  const [totalUsers, todaySignups, activeSubscribers, expiringSoon, expiredToday, recentSignupUsers] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }),
    User.countDocuments({ 'subscriptions.status': 'active' }),
    User.countDocuments({ subscriptions: { $elemMatch: { status: 'active', endDate: { $gte: todayStart, $lte: in3days } } } }),
    User.countDocuments({ subscriptions: { $elemMatch: { status: 'expired', endDate: { $gte: todayStart, $lte: todayEnd } } } }),
    User.find({ createdAt: { $gte: todayStart, $lte: todayEnd } }).select('name email phone').limit(10),
  ]);

  return { totalUsers, todaySignups, activeSubscribers, expiringSoon, expiredToday, recentSignupUsers, dateLabel: now.toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' }) };
}

function reportEmailHtml(stats) {
  const row = (label, value, color = '#1B4332') => `
    <tr>
      <td style="padding:12px 16px;background:#F6FBF7;border-radius:8px 0 0 8px;font-size:13px;color:#374151;">${label}</td>
      <td style="padding:12px 16px;background:#F6FBF7;border-radius:0 8px 8px 0;font-size:18px;font-weight:700;color:${color};text-align:right;">${value}</td>
    </tr><tr><td colspan="2" style="height:6px;"></td></tr>`;

  const signupRows = stats.recentSignupUsers.length
    ? stats.recentSignupUsers.map(u => `<li style="font-size:13px;color:#374151;margin-bottom:4px;">${u.name} — ${u.email}${u.phone ? ' · +91 ' + u.phone : ''}</li>`).join('')
    : '<li style="font-size:13px;color:#9A9A8E;">No new signups today.</li>';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
  <body style="margin:0;padding:0;background:#F5F5F0;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F0;padding:32px 16px;">
  <tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">
    <tr><td style="background:linear-gradient(135deg,#1B4332,#40916C);padding:28px 36px;">
      <div style="color:#fff;font-size:20px;font-weight:700;">🌿 SatvikMeals — Daily Report</div>
      <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px;">${stats.dateLabel}</div>
    </td></tr>
    <tr><td style="padding:28px 36px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${row('Total Users', stats.totalUsers)}
        ${row("Today's Signups", stats.todaySignups, '#1A5276')}
        ${row('Active Subscribers', stats.activeSubscribers, '#1B4332')}
        ${row('Expiring in 3 Days', stats.expiringSoon, '#E8650A')}
        ${row('Expired Today', stats.expiredToday, '#C0392B')}
      </table>
      <hr style="border:none;border-top:1px solid #EBEBEB;margin:20px 0;"/>
      <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#1B4332;">Today's New Signups</p>
      <ul style="margin:0;padding-left:18px;">${signupRows}</ul>
    </td></tr>
    <tr><td style="background:#F9F9F7;border-top:1px solid #EBEBEB;padding:18px 36px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#9A9A8E;">Automated daily report · <a href="https://satvikmeals.in/admin.html" style="color:#40916C;">Open Admin Panel</a></p>
    </td></tr>
  </table>
  </td></tr></table>
  </body></html>`;
}

function reportWhatsAppText(stats) {
  return `📊 *SatvikMeals Daily Report*\n${stats.dateLabel}\n\n` +
    `👥 Total Users: *${stats.totalUsers}*\n` +
    `🆕 Today's Signups: *${stats.todaySignups}*\n` +
    `✅ Active Subscribers: *${stats.activeSubscribers}*\n` +
    `⏰ Expiring in 3 Days: *${stats.expiringSoon}*\n` +
    `📋 Expired Today: *${stats.expiredToday}*\n\n` +
    (stats.todaySignups > 0
      ? `New signups:\n` + stats.recentSignupUsers.map(u => `• ${u.name} (${u.phone ? '+91 ' + u.phone : u.email})`).join('\n')
      : `No new signups today.`);
}

async function sendDailyReport() {
  console.log(`[DailyReport] Generating daily report at ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  try {
    const stats = await buildStats();

    // Email
    if (process.env.RESEND_API_KEY && process.env.ADMIN_EMAIL) {
      try {
        await resend.emails.send({
          from: FROM,
          to: process.env.ADMIN_EMAIL,
          subject: `📊 SatvikMeals Daily Report — ${stats.dateLabel}`,
          html: reportEmailHtml(stats)
        });
        console.log('[DailyReport] ✅ Email sent to admin.');
      } catch (err) {
        console.error('[DailyReport] Email failed:', err.message);
      }
    }

    // WhatsApp
    try {
      await sendAdminWA(reportWhatsAppText(stats));
      console.log('[DailyReport] ✅ WhatsApp sent to admin.');
    } catch (err) {
      console.error('[DailyReport] WhatsApp failed:', err.message);
    }
  } catch (err) {
    console.error('[DailyReport] ❌ Error generating daily report:', err.message);
  }
}

module.exports = { startReportCron, sendDailyReport };
