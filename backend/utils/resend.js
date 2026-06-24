'use strict';
/**
 * SatvikMeals — Email utility via Resend
 * Install: npm install resend
 * Env vars needed:
 *   RESEND_API_KEY   — your Resend API key
 *   RESEND_FROM      — e.g. "SatvikMeals <hello@satvikmeals.in>"
 *   ADMIN_EMAIL      — admin's email for signup alerts
 *
 * Theme: matches the live website —
 *   Saffron    #E8650A  (primary brand accent, used in hero/CTA on site)
 *   Dark Green #143D2A  (header/footer, matches site's --g8)
 *   Mid Green  #2E7D55  (gradient partner, matches site's --g6)
 *   Cream bg   #FAF8F2  (matches site's --cream background)
 *
 * Layout notes (professional email proportions):
 *   - 600px canvas (industry-standard email width — renders correctly across
 *     Gmail, Outlook, Apple Mail without horizontal scroll on any device)
 *   - 8px spacing scale throughout (8/16/24/32/40) instead of arbitrary values
 *   - Header logo sized to sit comfortably beside the wordmark, not dominate it
 *   - Single accent color used sparingly (CTA buttons only) rather than
 *     scattered across borders/backgrounds, for a calmer, more premium feel
 */

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.RESEND_FROM || 'SatvikMeals <hello@satvikmeals.in>';
const LOGO_URL = process.env.LOGO_URL || 'https://satvikmeals.in/logo.jpg';

// ── Brand colors & reusable HTML layout ───────────────────────────────────────
// `preheaderText` is the short snippet shown in inbox previews (Gmail/Outlook).
// Sending transactional, personalized content (not phrased like a marketing
// blast) plus these specific headers below are what keep Gmail from routing
// the message to the Promotions tab — Gmail's classifier looks at both
// content style and header signals together. See the note above send().
function layout(title, bodyHtml, preheaderText = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<title>${title}</title>
<!--[if mso]>
<style type="text/css">table {border-collapse: collapse;} body, table, td, p, a, li {font-family: Arial, sans-serif !important;}</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background:#FAF8F2;font-family:-apple-system,'Segoe UI',Roboto,'Plus Jakarta Sans',Arial,sans-serif;">
<!-- Preheader: invisible in the email body, shown as inbox preview text -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preheaderText}&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF8F2;">
<tr><td align="center" style="padding:40px 16px;">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(15,45,31,0.06);">

    <!-- Header -->
    <tr>
      <td style="background:#143D2A;padding:32px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="44" style="vertical-align:middle;">
              <img src="${LOGO_URL}" width="44" height="44" alt="SatvikMeals" style="display:block;border-radius:10px;"/>
            </td>
            <td style="vertical-align:middle;padding-left:14px;">
              <div style="font-size:19px;font-weight:700;color:#FFFFFF;letter-spacing:-0.2px;line-height:1.2;">SatvikMeals</div>
              <div style="font-size:11px;color:#A8C9B5;margin-top:3px;letter-spacing:0.04em;">Pure Veg &middot; Jain &middot; No Onion-Garlic &middot; Patna</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td style="padding:40px 40px 32px;">
        ${bodyHtml}
      </td>
    </tr>

    <!-- Divider -->
    <tr><td style="padding:0 40px;"><div style="border-top:1px solid #ECEAE3;"></div></td></tr>

    <!-- Footer -->
    <tr>
      <td style="padding:28px 40px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="vertical-align:middle;width:36px;">
              <img src="${LOGO_URL}" width="28" height="28" alt="SatvikMeals" style="display:block;border-radius:6px;opacity:0.9;"/>
            </td>
            <td style="vertical-align:middle;padding-left:10px;">
              <div style="font-size:13px;font-weight:700;color:#143D2A;">SatvikMeals</div>
              <div style="font-size:11px;color:#9A9488;margin-top:1px;">Patna, Bihar, India</div>
            </td>
          </tr>
        </table>
        <div style="margin-top:16px;font-size:12px;line-height:1.8;">
          <a href="https://satvikmeals.in" style="color:#2E7D55;text-decoration:none;font-weight:600;">satvikmeals.in</a>
          <span style="color:#D5D0C5;">&nbsp;&nbsp;|&nbsp;&nbsp;</span>
          <a href="https://wa.me/919031447621" style="color:#2E7D55;text-decoration:none;font-weight:600;">WhatsApp</a>
          <span style="color:#D5D0C5;">&nbsp;&nbsp;|&nbsp;&nbsp;</span>
          <a href="tel:+916201276506" style="color:#2E7D55;text-decoration:none;font-weight:600;">Call Us</a>
        </div>
        <div style="margin-top:14px;font-size:11px;color:#B0AB9E;line-height:1.6;">You're receiving this because you have an account with SatvikMeals.</div>
      </td>
    </tr>

  </table>

  <div style="max-width:600px;margin-top:20px;font-size:11px;color:#B0AB9E;">
    &copy; ${new Date().getFullYear()} SatvikMeals. All rights reserved.
  </div>

</td></tr>
</table>
</body>
</html>`;
}

function heading(text) {
  return `<h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#143D2A;line-height:1.35;font-family:Georgia,'Playfair Display',serif;">${text}</h1>`;
}
function subtext(text) {
  return `<p style="margin:0 0 28px;font-size:15px;color:#5A6B61;line-height:1.65;">${text}</p>`;
}
// Info table — single rounded container instead of per-row pill backgrounds,
// for a calmer, more "receipt-like" professional look.
function infoTable(rows) {
  const rowsHtml = rows.map(([label, value], i) => `
    <tr>
      <td style="padding:11px 16px;${i > 0 ? 'border-top:1px solid #ECEAE3;' : ''}font-size:13px;color:#8A9A8F;width:38%;">${label}</td>
      <td style="padding:11px 16px;${i > 0 ? 'border-top:1px solid #ECEAE3;' : ''}font-size:13px;color:#1F2D24;font-weight:600;">${value}</td>
    </tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F9F6;border:1px solid #ECEAE3;border-radius:10px;margin-bottom:28px;">${rowsHtml}</table>`;
}
// Backward-compatible alias for the old per-row API used elsewhere in this file
function infoRow(label, value) {
  return { label, value };
}
function ctaButton(text, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;">
    <tr><td style="border-radius:8px;background:#E8650A;">
      <a href="${url}" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">${text}</a>
    </td></tr>
  </table>`;
}
function divider() {
  return `<div style="border-top:1px solid #ECEAE3;margin:28px 0;"></div>`;
}

// ── Safe send wrapper — never crash the main flow ─────────────────────────────
// Headers below are signals that help Gmail/Outlook classify this as a
// transactional/personal message rather than a marketing email — combined
// with the fact that the content itself addresses one named recipient about
// their own account (not a broadcast), this keeps mail out of Promotions.
// The single biggest factor is still sender reputation/domain authentication
// (SPF/DKIM/DMARC) — see the note in .env.example about verifying your
// sending domain in the Resend dashboard.
async function send({ to, subject, html, tag = 'transactional' }) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[Resend] RESEND_API_KEY not set — skipping email to ${to}`);
    return;
  }
  try {
    const r = await resend.emails.send({
      from: FROM,
      to,
      subject,
      html,
      headers: {
        'X-Entity-Ref-ID': `satvikmeals-${tag}-${Date.now()}`,
        'Precedence': 'transactional',
        'X-Priority': '3',
      },
      tags: [{ name: 'category', value: tag }],
    });
    console.log(`[Resend] Sent "${subject}" to ${to} — id: ${r.id}`);
  } catch (err) {
    console.error(`[Resend] Failed to send "${subject}" to ${to}:`, err.message);
  }
}

// ── 1. Welcome email — sent to new user once onboarding is complete ──────────
async function sendWelcomeEmail(user) {
  const firstName = user.name?.split(' ')[0] || 'there';
  const body = `
    ${heading(`Welcome to SatvikMeals, ${firstName}!`)}
    ${subtext('We\'re glad to have you with us. Fresh, pure vegetarian meals are now just a WhatsApp message away.')}
    ${infoTable([
      ['Name', user.name || '—'],
      ['Email', user.email],
      ['Mobile', user.phone ? '+91 ' + user.phone : 'Not added yet'],
      ['Area', user.location?.address?.split(',').slice(0,2).join(',') || 'Not set yet'],
    ])}
    <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#143D2A;">What makes SatvikMeals different</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
      <tr><td style="padding:5px 0;font-size:14px;color:#3D4A41;">🌿&nbsp;&nbsp;100% pure vegetarian kitchen</td></tr>
      <tr><td style="padding:5px 0;font-size:14px;color:#3D4A41;">🕉️&nbsp;&nbsp;Jain &amp; Satvik meals available</td></tr>
      <tr><td style="padding:5px 0;font-size:14px;color:#3D4A41;">🧅&nbsp;&nbsp;No onion-garlic options, cooked separately</td></tr>
      <tr><td style="padding:5px 0;font-size:14px;color:#3D4A41;">⚡&nbsp;&nbsp;Instant delivery + daily tiffin subscriptions</td></tr>
      <tr><td style="padding:5px 0;font-size:14px;color:#3D4A41;">📍&nbsp;&nbsp;Serving all areas of Patna</td></tr>
    </table>
    ${ctaButton('View Our Plans', 'https://satvikmeals.in/plans.html')}
    <p style="margin:20px 0 0;font-size:13px;color:#8A9A8F;">To confirm a plan, just WhatsApp us or call — we'll activate it for you.</p>`;
  await send({
    to: user.email,
    subject: `Welcome to SatvikMeals, ${firstName} — your account is ready`,
    html: layout('Welcome to SatvikMeals', body, `Hi ${firstName}, your SatvikMeals account is set up. Here's what to do next.`),
    tag: 'welcome'
  });
}

// ── 2. Plan activated — sent to user when admin assigns a plan ────────────────
async function sendPlanActivatedEmail(user, plan) {
  const startDate = new Date(plan.startDate).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });
  const endDate   = new Date(plan.endDate).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });
  const body = `
    ${heading('Your plan is active')}
    ${subtext('Great news — your SatvikMeals subscription has been activated. Fresh meals are on their way.')}
    ${infoTable([
      ['Plan', plan.planName],
      ['Start Date', startDate],
      ['Expiry Date', endDate],
      ['Delivery Area', user.location?.address?.split(',').slice(0,2).join(',') || '—'],
    ])}
    <p style="margin:0 0 28px;font-size:14px;color:#5A6B61;line-height:1.65;">
      Your meals will be delivered daily as per your plan. If you need to pause, change your delivery address, or have any questions — just WhatsApp us.
    </p>
    ${ctaButton('View Dashboard', 'https://satvikmeals.in/dashboard.html')}`;
  await send({
    to: user.email,
    subject: `Your SatvikMeals plan is now active — ${plan.planName}`,
    html: layout('Plan Activated', body, `Your ${plan.planName} subscription is active through ${endDate}.`),
    tag: 'plan-activated'
  });
}

// ── 3. Expiry warning — sent 2 days before plan expires ───────────────────────
async function sendExpiryWarningEmail(user, plan) {
  const endDate = new Date(plan.endDate).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });
  const body = `
    ${heading('Your plan expires soon')}
    ${subtext(`Your current plan expires on <strong style="color:#143D2A;">${endDate}</strong>. Renew now to keep your daily meals coming without any break.`)}
    ${infoTable([
      ['Plan', plan.planName],
      ['Expires On', endDate],
    ])}
    <p style="margin:0 0 28px;font-size:14px;color:#5A6B61;line-height:1.65;">
      To renew, simply WhatsApp us and we'll take care of it within minutes.
    </p>
    ${ctaButton('Renew via WhatsApp', 'https://wa.me/919031447621?text=Hi+SatvikMeals!+I+want+to+renew+my+plan.')}`;
  await send({
    to: user.email,
    subject: `Your SatvikMeals plan expires on ${endDate}`,
    html: layout('Plan Expiring Soon', body, `Your ${plan.planName} plan expires on ${endDate} — renew to avoid a break in service.`),
    tag: 'expiry-warning'
  });
}

// ── 4. Plan expired — sent on expiry day ─────────────────────────────────────
async function sendPlanExpiredEmail(user, plan) {
  const body = `
    ${heading('Your plan has expired')}
    ${subtext(`Your <strong style="color:#143D2A;">${plan.planName}</strong> subscription has ended. We hope you enjoyed your SatvikMeals experience.`)}
    <p style="margin:0 0 28px;font-size:14px;color:#5A6B61;line-height:1.65;">
      Renew your subscription to continue receiving fresh, pure vegetarian meals daily. WhatsApp us or call to get your plan reactivated today.
    </p>
    ${ctaButton('Renew Now via WhatsApp', 'https://wa.me/919031447621?text=Hi+SatvikMeals!+My+plan+expired.+I+want+to+renew.')}
    ${divider()}
    <p style="margin:0;font-size:13px;color:#8A9A8F;">We'd love to have you back — see you soon.</p>`;
  await send({
    to: user.email,
    subject: `Your SatvikMeals plan has expired — ${plan.planName}`,
    html: layout('Plan Expired', body, `Your ${plan.planName} subscription has ended. Renew to keep your meals coming.`),
    tag: 'plan-expired'
  });
}

// ── 5. Admin new-signup alert ─────────────────────────────────────────────────
async function sendAdminSignupAlert(user) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;
  const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const body = `
    ${heading('New user signed up')}
    ${subtext(`A new user just joined SatvikMeals at ${time}.`)}
    ${infoTable([
      ['Name', user.name || '—'],
      ['Email', user.email],
      ['Mobile', user.phone ? '+91 ' + user.phone : 'Not added yet'],
      ['Referral Code', user.referralCode || '—'],
      ['Referred By', user.referredBy || 'Direct'],
      ['Joined At', time],
    ])}
    ${ctaButton('View in Admin Panel', 'https://satvikmeals.in/admin.html')}`;
  await send({
    to: adminEmail,
    subject: `New signup: ${user.name} (${user.email})`,
    html: layout('New Signup Alert', body, `${user.name} just completed signup with phone and location.`),
    tag: 'admin-alert'
  });
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
    const firstName = user.name?.split(' ')[0] || 'there';
    const body = `
      ${heading(`Hi ${firstName},`)}
      <div style="font-size:14px;color:#3D4A41;line-height:1.75;margin-bottom:28px;">${messageHtml}</div>
      ${ctaButton('Visit SatvikMeals', 'https://satvikmeals.in')}`;
    try {
      await resend.emails.send({
        from: FROM,
        to: user.email,
        subject,
        html: layout(subject, body, messageHtml.replace(/<[^>]+>/g, '').slice(0, 100)),
        headers: { 'X-Entity-Ref-ID': `satvikmeals-broadcast-${Date.now()}`, 'Precedence': 'transactional' },
        tags: [{ name: 'category', value: 'broadcast' }],
      });
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
