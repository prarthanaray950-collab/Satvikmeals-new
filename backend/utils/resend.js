'use strict';
/**
 * SatvikMeals — Email utility via Resend
 * Install: npm install resend
 * Env vars needed:
 *   RESEND_API_KEY   — your Resend API key
 *   RESEND_FROM      — e.g. "SatvikMeals <hello@satvikmeals.in>"
 *   ADMIN_EMAIL      — admin's email for signup alerts
 */

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.RESEND_FROM || 'SatvikMeals <hello@satvikmeals.in>';

// ── Brand colors & reusable HTML layout ───────────────────────────────────────
function layout(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#F5F5F0;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F0;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">
      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,#1B4332 0%,#40916C 100%);padding:32px 36px 28px;text-align:center;">
          <div style="font-size:22px;font-weight:700;color:#FFFFFF;letter-spacing:-0.3px;">🌿 SatvikMeals</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.65);margin-top:4px;letter-spacing:0.08em;text-transform:uppercase;">Pure Veg · Jain · No Onion-Garlic</div>
        </td>
      </tr>
      <!-- Body -->
      <tr><td style="padding:32px 36px 28px;">${bodyHtml}</td></tr>
      <!-- Footer -->
      <tr>
        <td style="background:#F9F9F7;border-top:1px solid #EBEBEB;padding:20px 36px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9A9A8E;">
            SatvikMeals, Patna, Bihar, India<br/>
            <a href="https://satvikmeals.in" style="color:#40916C;text-decoration:none;">satvikmeals.in</a>
            &nbsp;·&nbsp;
            <a href="https://wa.me/919031447621" style="color:#40916C;text-decoration:none;">WhatsApp Us</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function heading(text) {
  return `<h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0F2D1F;line-height:1.2;">${text}</h1>`;
}
function subtext(text) {
  return `<p style="margin:0 0 24px;font-size:14px;color:#6B7280;line-height:1.6;">${text}</p>`;
}
function infoRow(label, value) {
  return `<tr>
    <td style="padding:10px 14px;background:#F6FBF7;border-radius:8px 0 0 8px;font-size:13px;font-weight:600;color:#1B4332;white-space:nowrap;">${label}</td>
    <td style="padding:10px 14px;background:#F6FBF7;border-radius:0 8px 8px 0;font-size:13px;color:#374151;border-left:3px solid #E8F5ED;">${value}</td>
  </tr><tr><td colspan="2" style="height:6px;"></td></tr>`;
}
function ctaButton(text, url) {
  return `<div style="margin:24px 0 8px;text-align:center;">
    <a href="${url}" style="display:inline-block;background:#1B4332;color:#FFFFFF;font-size:15px;font-weight:600;padding:14px 36px;border-radius:10px;text-decoration:none;letter-spacing:0.02em;">${text}</a>
  </div>`;
}
function divider() {
  return `<hr style="border:none;border-top:1px solid #EBEBEB;margin:24px 0;"/>`;
}

// ── Safe send wrapper — never crash the main flow ─────────────────────────────
async function send({ to, subject, html, headers = {} }) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[Resend] RESEND_API_KEY not set — skipping email to ${to}`);
    return;
  }
  try {
    // Transactional headers help Gmail route to Primary tab, not Promotions
    const r = await resend.emails.send({
      from: FROM, to, subject, html,
      headers: {
        'X-Entity-Ref-ID': Date.now().toString(),
        'Precedence': 'bulk',
        ...headers
      }
    });
    console.log(`[Resend] Sent "${subject}" to ${to} — id: ${r.id}`);
  } catch (err) {
    console.error(`[Resend] Failed to send "${subject}" to ${to}:`, err.message);
  }
}

// ── 1. Welcome email — sent to new user on signup ─────────────────────────────
async function sendWelcomeEmail(user) {
  const body = `
    ${heading(`Welcome to SatvikMeals, ${user.name?.split(' ')[0] || 'there'}! 🌿`)}
    ${subtext('We\'re thrilled to have you. Fresh, pure vegetarian meals are now just a WhatsApp away.')}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      ${infoRow('Name', user.name || '—')}
      ${infoRow('Email', user.email)}
      ${infoRow('Mobile', user.phone ? '+91 ' + user.phone : 'Not added yet — add in your profile')}
      ${infoRow('Area', user.location?.address?.split(',').slice(0,2).join(',') || 'Not set yet')}
    </table>
    ${divider()}
    <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#1B4332;">What makes SatvikMeals special?</p>
    <ul style="margin:0 0 20px;padding-left:18px;font-size:13px;color:#374151;line-height:2;">
      <li>🌿 100% Pure Vegetarian kitchen</li>
      <li>🕉️ Jain &amp; Satvik meals available</li>
      <li>🧅 No Onion-Garlic options, cooked separately</li>
      <li>⚡ Instant delivery + daily tiffin subscriptions</li>
      <li>📍 Serving all areas of Patna</li>
    </ul>
    ${ctaButton('View Our Plans', 'https://satvikmeals.in/plans.html')}
    <p style="margin:20px 0 0;font-size:12px;color:#9A9A8E;text-align:center;">To confirm a plan, just WhatsApp us or call — we'll activate it for you.</p>`;
  await send({ to: user.email, subject: 'Your SatvikMeals account is ready', html: layout('Welcome to SatvikMeals', body) });
}

// ── 2. Plan activated — sent to user when admin assigns a plan ────────────────
async function sendPlanActivatedEmail(user, plan) {
  const startDate = new Date(plan.startDate).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });
  const endDate   = new Date(plan.endDate).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });
  const body = `
    ${heading('Your Plan is Active! ✅')}
    ${subtext('Great news — your SatvikMeals subscription has been activated. Fresh meals are on their way!')}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      ${infoRow('Plan', plan.planName)}
      ${infoRow('Start Date', startDate)}
      ${infoRow('Expiry Date', endDate)}
      ${infoRow('Delivery Area', user.location?.address?.split(',').slice(0,2).join(',') || '—')}
    </table>
    ${divider()}
    <p style="margin:0 0 16px;font-size:13px;color:#374151;line-height:1.6;">
      Your meals will be delivered daily as per your plan. If you need to pause, change your delivery address, or have any questions — just WhatsApp us.
    </p>
    ${ctaButton('View Dashboard', 'https://satvikmeals.in/dashboard.html')}`;
  await send({ to: user.email, subject: 'Your SatvikMeals plan is now active ✅', html: layout('Plan Activated', body) });
}

// ── 3. Expiry warning — sent 2 days before plan expires ───────────────────────
async function sendExpiryWarningEmail(user, plan) {
  const endDate = new Date(plan.endDate).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });
  const body = `
    ${heading('Your Plan Expires Soon ⏰')}
    ${subtext(`Your current plan expires on <strong>${endDate}</strong>. Renew now to keep your daily meals coming without any break.`)}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      ${infoRow('Plan', plan.planName)}
      ${infoRow('Expires On', endDate)}
    </table>
    ${divider()}
    <p style="margin:0 0 16px;font-size:13px;color:#374151;line-height:1.6;">
      To renew, simply WhatsApp us and we'll take care of it within minutes.
    </p>
    ${ctaButton('Renew via WhatsApp', 'https://wa.me/919031447621?text=Hi+SatvikMeals!+I+want+to+renew+my+plan.')}`;
  await send({ to: user.email, subject: 'Your SatvikMeals plan expires in 2 days ⏰', html: layout('Plan Expiring Soon', body) });
}

// ── 4. Plan expired — sent on expiry day ─────────────────────────────────────
async function sendPlanExpiredEmail(user, plan) {
  const body = `
    ${heading('Your Plan Has Expired')}
    ${subtext(`Your <strong>${plan.planName}</strong> subscription has ended. We hope you enjoyed your SatvikMeals experience!`)}
    <p style="margin:0 0 20px;font-size:13px;color:#374151;line-height:1.6;">
      Renew your subscription to continue receiving fresh, pure vegetarian meals daily. WhatsApp us or call to get your plan reactivated today.
    </p>
    ${ctaButton('Renew Now via WhatsApp', 'https://wa.me/919031447621?text=Hi+SatvikMeals!+My+plan+expired.+I+want+to+renew.')}
    ${divider()}
    <p style="margin:0;font-size:12px;color:#9A9A8E;text-align:center;">We'd love to have you back. See you soon! 🌿</p>`;
  await send({ to: user.email, subject: 'Your SatvikMeals plan has expired', html: layout('Plan Expired', body) });
}

// ── 5. Admin new-signup alert ─────────────────────────────────────────────────
async function sendAdminSignupAlert(user) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;
  const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const body = `
    ${heading('New User Signed Up 🎉')}
    ${subtext(`A new user just joined SatvikMeals at ${time}.`)}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      ${infoRow('Name', user.name || '—')}
      ${infoRow('Email', user.email)}
      ${infoRow('Mobile', user.phone ? '+91 ' + user.phone : 'Not added yet')}
      ${infoRow('Referral Code', user.referralCode || '—')}
      ${infoRow('Referred By', user.referredBy || 'Direct')}
      ${infoRow('Joined At', time)}
    </table>
    ${ctaButton('View in Admin Panel', 'https://satvikmeals.in/admin.html')}`;
  await send({ to: adminEmail, subject: `New signup: ${user.name} (${user.email})`, html: layout('New Signup Alert', body) });
}

// ── 6. Broadcast email — to list of users ────────────────────────────────────
async function sendBroadcastEmail(users, subject, messageHtml) {
  if (!process.env.RESEND_API_KEY) {
    console.log('[Resend] RESEND_API_KEY not set — skipping broadcast');
    return;
  }
  let sent = 0, failed = 0;
  for (const user of users) {
    if (!user.email) { failed++; continue; }
    const body = `
      ${heading('A message from SatvikMeals 🌿')}
      <div style="font-size:14px;color:#374151;line-height:1.8;margin-bottom:20px;">${messageHtml}</div>
      ${divider()}
      ${ctaButton('Visit SatvikMeals', 'https://satvikmeals.in')}`;
    try {
      await resend.emails.send({ from: FROM, to: user.email, subject, html: layout(subject, body) });
      sent++;
    } catch (err) {
      console.error(`[Resend] Broadcast failed for ${user.email}:`, err.message);
      failed++;
    }
    // Small delay to respect rate limits
    await new Promise(r => setTimeout(r, 120));
  }
  console.log(`[Resend] Broadcast complete — sent: ${sent}, failed: ${failed}`);
  return { sent, failed };
}

module.exports = {
  sendWelcomeEmail,
  sendPlanActivatedEmail,
  sendExpiryWarningEmail,
  sendPlanExpiredEmail,
  sendAdminSignupAlert,
  sendBroadcastEmail,
};
