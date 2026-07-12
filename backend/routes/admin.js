const express = require('express');
const { protect, adminOnly } = require('../middleware/auth');
const { Plan, Menu, Order, Payment } = require('../models/index');
const User = require('../models/User');
const B2BLead = require('../models/B2BLead');
const { sendPlanActivatedEmail, sendBroadcastEmail } = require('../utils/resend');
const { sendPlanActivatedWA, sendBroadcastWA, sendWelcomeWA, sendWA, connect: waConnect, disconnect: waDisconnect, getStatus: waGetStatus, getQrImage: waGetQrImage } = require('../utils/whatsapp');
const router = express.Router();
router.use(protect, adminOnly);

// PLANS
router.get('/plans',        async (req, res) => res.json(await Plan.find().sort('sortOrder')));
router.post('/plans',       async (req, res) => { try { res.status(201).json(await Plan.create(req.body)); } catch(e){ res.status(400).json({message:e.message}); }});
router.put('/plans/:id',    async (req, res) => { const p = await Plan.findByIdAndUpdate(req.params.id, req.body, {new:true}); p ? res.json(p) : res.status(404).json({message:'Not found'}); });
router.delete('/plans/:id', async (req, res) => { await Plan.findByIdAndDelete(req.params.id); res.json({message:'Deleted'}); });

// MENU
router.get('/menu', async (req, res) => res.json(await Menu.find().sort('-weekStarting').limit(8)));
router.post('/menu', async (req, res) => { try { res.status(201).json(await Menu.create(req.body)); } catch(e){ res.status(400).json({message:e.message}); }});
router.put('/menu/:id', async (req, res) => { const m = await Menu.findByIdAndUpdate(req.params.id, req.body, {new:true}); m ? res.json(m) : res.status(404).json({message:'Not found'}); });
router.delete('/menu/:id', async (req, res) => { await Menu.findByIdAndDelete(req.params.id); res.json({message:'Deleted'}); });

// DASHBOARD STATS — upgraded with active subscribers, expiring soon, today signups
router.get('/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const todayEnd   = new Date(now); todayEnd.setHours(23,59,59,999);
    const in3days    = new Date(todayEnd); in3days.setDate(in3days.getDate() + 3);

    const [totalUsers, totalOrders, rev, recentOrders, recentUsers,
           activeSubscribers, expiringSoon, todaySignups] = await Promise.all([
      User.countDocuments(),
      Order.countDocuments({ paymentStatus: 'paid' }),
      Payment.aggregate([{$match:{status:'paid'}},{$group:{_id:null,total:{$sum:'$amount'}}}]),
      Order.find({ paymentStatus: 'paid' }).sort('-createdAt').limit(10),
      User.find().sort('-createdAt').limit(10).select('name email phone createdAt coins subscriptions'),
      // Count users with at least one active subscription
      User.countDocuments({ 'subscriptions.status': 'active' }),
      // Count users with active plan ending within 3 days
      User.countDocuments({
        'subscriptions': { $elemMatch: { status: 'active', endDate: { $gte: todayStart, $lte: in3days } } }
      }),
      // Count users who signed up today
      User.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }),
    ]);

    res.json({
      totalUsers, totalOrders,
      totalRevenue: rev[0]?.total || 0,
      activeSubscribers, expiringSoon, todaySignups,
      recentOrders, recentUsers
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/users',    async (req, res) => { const u = await User.find().sort('-createdAt').select('-__v'); res.json(u); });
router.get('/orders',   async (req, res) => { const o = await Order.find().sort('-createdAt'); res.json(o); });
router.get('/payments', async (req, res) => { const p = await Payment.find().sort('-createdAt'); res.json(p); });

// ── CREATE USER (admin-only) ──────────────────────────────────────────────────
// Replaces the old, insecure use of the public /api/auth/dev-login endpoint for
// admin "Add User". This route is already behind protect + adminOnly (see the
// router.use at the top of this file), so only a logged-in admin can create a
// user — no token is minted for the caller and no account-takeover is possible.
// Optionally sets phone and role in the same request.
router.post('/users', async (req, res) => {
  try {
    const { name, email, phone, role, referralCode } = req.body || {};
    if (!name || !email) return res.status(400).json({ message: 'Name and email are required.' });

    const emailLower = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower))
      return res.status(400).json({ message: 'Enter a valid email address.' });

    let cleanedPhone;
    if (phone) {
      cleanedPhone = phone.toString().replace(/\D/g, '');
      if (cleanedPhone.length !== 10 || !/^[6-9]/.test(cleanedPhone))
        return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number.' });
    }

    if (await User.findOne({ email: emailLower }))
      return res.status(409).json({ message: 'A user with this email already exists.' });
    if (cleanedPhone && await User.findOne({ phone: cleanedPhone }))
      return res.status(409).json({ message: 'A user with this phone number already exists.' });

    // Build the doc; retry a few times only on a referralCode unique collision.
    const base = {
      name: name.trim(),
      email: emailLower,
      referredBy: referralCode || null,
      ...(cleanedPhone ? { phone: cleanedPhone } : {}),
      ...(role === 'admin' ? { role: 'admin' } : {}),
    };
    let user;
    for (let i = 0; i < 5; i++) {
      try { user = await User.create(base); break; }
      catch (e) {
        if (e.code === 11000 && e.keyPattern?.referralCode && i < 4) continue;
        throw e;
      }
    }

    if (referralCode) {
      await User.findOneAndUpdate(
        { referralCode },
        { $push: { referredUsers: { email: emailLower, name: name.trim(), joinedAt: new Date() } } }
      ).catch(() => {});
    }

    res.status(201).json({
      success: true,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, referralCode: user.referralCode },
    });
  } catch (err) {
    console.error('[Admin/create-user]', err.message);
    res.status(500).json({ message: 'Failed to create user.' });
  }
});

// ── SET USER ROLE (admin-only) ────────────────────────────────────────────────
// admin.html called PUT /api/admin/users/:id/role but the route did not exist,
// so role changes silently failed. Implement it properly.
router.put('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body || {};
    if (!['user', 'admin'].includes(role))
      return res.status(400).json({ message: "role must be 'user' or 'admin'." });
    const u = await User.findByIdAndUpdate(req.params.id, { $set: { role } }, { new: true });
    if (!u) return res.status(404).json({ message: 'User not found.' });
    res.json({ success: true, user: { id: u._id, role: u.role } });
  } catch (err) {
    console.error('[Admin/set-role]', err.message);
    res.status(500).json({ message: 'Failed to update role.' });
  }
});

// ── ASSIGN PLAN TO USER ───────────────────────────────────────────────────────
router.post('/assign-plan/:userId', async (req, res) => {
  try {
    const { planName, startDate, endDate, price } = req.body;
    if (!planName || !endDate) return res.status(400).json({ message: 'planName and endDate are required.' });

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const start = startDate ? new Date(startDate) : new Date();
    const end   = new Date(endDate);

    // Deactivate any existing active subscription
    user.subscriptions.forEach(s => { if (s.status === 'active') s.status = 'paused'; });

    // Add new active subscription (price stored for monthly invoice generation)
    user.subscriptions.push({ planName, startDate: start, endDate: end, status: 'active', price: Number(price) || 0 });
    await user.save();

    const plan = { planName, startDate: start, endDate: end };

    // Fire notifications — non-blocking
    sendPlanActivatedEmail(user, plan).catch(e => console.error('[Resend] plan activated:', e.message));
    sendPlanActivatedWA(user, plan).catch(e => console.error('[WhatsApp] plan activated:', e.message));

    res.json({ success: true, message: `Plan "${planName}" assigned to ${user.name}.`, user });
  } catch (err) {
    console.error('[Admin/assign-plan]', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── BROADCAST EMAIL + WHATSAPP ────────────────────────────────────────────────
router.post('/broadcast', async (req, res) => {
  try {
    const { subject, message, target, area, channels } = req.body;
    // target: 'all' | 'active' | 'area'
    // channels: array e.g. ['email', 'whatsapp']
    if (!message) return res.status(400).json({ message: 'message is required.' });

    let query = {};
    if (target === 'active') query = { 'subscriptions.status': 'active' };
    if (target === 'area' && area) query = { 'location.address': { $regex: area, $options: 'i' } };

    const users = await User.find(query).select('name email phone location subscriptions');
    const ch = channels || ['email', 'whatsapp'];

    // Validate up-front so we can warn instead of silently skipping. Previously
    // an email broadcast with a blank subject was dropped with no feedback.
    const warnings = [];
    const wantEmail = ch.includes('email');
    const wantWa    = ch.includes('whatsapp');
    if (wantEmail && !subject) warnings.push('Email channel skipped: a subject line is required for email.');
    if (!users.length)         warnings.push('No users matched the selected audience.');

    // Respond immediately. Sending to many users over Resend + Baileys (with the
    // 1.5s/message WhatsApp anti-spam delay) can take minutes — holding the HTTP
    // request open that long times out the admin's browser and looks like a hang.
    res.json({
      success: true,
      accepted: true,
      userCount: users.length,
      channels: ch,
      warnings,
      message: `Broadcast queued for ${users.length} user(s). Delivery is running in the background; check server logs for the final sent/failed counts.`,
    });

    // ── Fire-and-forget delivery (does not block the response) ────────────────
    ;(async () => {
      try {
        if (wantEmail && subject) {
          const r = await sendBroadcastEmail(users, subject, message);
          console.log('[Admin/broadcast] Email done:', r);
        }
        if (wantWa) {
          const r = await sendBroadcastWA(users, message);
          console.log('[Admin/broadcast] WhatsApp done:', r);
        }
      } catch (e) {
        console.error('[Admin/broadcast] background delivery error:', e.message);
      }
    })();
  } catch (err) {
    console.error('[Admin/broadcast]', err.message);
    if (!res.headersSent) res.status(500).json({ message: err.message });
  }
});

// ── WHATSAPP SESSION MANAGEMENT ───────────────────────────────────────────────
// Admin can connect/disconnect the SatvikMeals WhatsApp number entirely from
// the browser. The session is stored in MongoDB so it survives Render
// restarts — no need to keep server console access open to scan a QR.

// Returns current connection status + QR image (if one is pending)
router.get('/whatsapp/status', async (req, res) => {
  try {
    const status = waGetStatus();
    const qrImage = status.status === 'qr_pending' ? await waGetQrImage() : null;
    res.json({ ...status, qrImage });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Starts a new connection attempt — triggers QR generation if no valid session exists
router.post('/whatsapp/connect', async (req, res) => {
  try {
    const status = await waConnect();
    res.json(status);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Polls for the QR code once connect() has been triggered (QR may take a second to arrive)
router.get('/whatsapp/qr', async (req, res) => {
  try {
    const status = waGetStatus();
    const qrImage = await waGetQrImage();
    res.json({ ...status, qrImage });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Logs out and wipes the session from MongoDB — admin can then connect a different number
router.post('/whatsapp/disconnect', async (req, res) => {
  try {
    const status = await waDisconnect();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── FORCE RESET — last resort if "Disconnect" itself appears stuck ───────────
// Wipes the WaSession collection directly via Mongoose, bypassing the
// Baileys socket entirely (no .logout(), no .end(), no event handlers
// touched). Use this if you were already stuck on "Connecting…" with no QR
// before this fix was deployed — a normal Disconnect click may not fully
// recover from that state since the in-memory module was already wedged.
// After calling this, restart the server once (Render: Manual Deploy or
// just wait for the next natural restart) so the WhatsApp module reloads
// with totally clean in-memory state, then click Connect again.
router.post('/whatsapp/force-reset', async (req, res) => {
  try {
    const WaSession = require('../models/WaSession');
    const result = await WaSession.deleteMany({});
    res.json({
      success: true,
      message: `Force reset complete. Removed ${result.deletedCount} session document(s) from MongoDB. ` +
        `Please restart the server (redeploy on Render) and then click "Connect WhatsApp" again.`
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── SEND A MESSAGE — used by the admin panel's "Send a Message" tool ─────────
// type: 'test' | 'custom' | 'welcome' | 'plan'
//   test    → sends a short confirmation message to ADMIN_WA_NUMBER (no userId needed)
//   custom  → sends `message` to the selected user
//   welcome → re-sends the standard welcome message to the selected user
//   plan    → sends the plan-activated message using planName/startDate/endDate (does NOT modify the DB)
router.post('/whatsapp/send', async (req, res) => {
  try {
    const { type, userId, message, planName, startDate, endDate } = req.body;
    const status = waGetStatus();
    if (status.status !== 'connected') {
      return res.status(400).json({ message: `WhatsApp is not connected (status: ${status.status}). Connect it first from this page.` });
    }

    if (type === 'test') {
      const adminNum = process.env.ADMIN_WA_NUMBER;
      if (!adminNum) return res.status(400).json({ message: 'ADMIN_WA_NUMBER is not set in environment variables.' });
      const result = await sendWA(adminNum, `✅ *Test Message — SatvikMeals*\n\nThis confirms your WhatsApp connection is working correctly.\n\nSent at: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      if (!result.ok) return res.status(502).json({ message: `Failed to send: ${result.error}` });
      return res.json({ success: true, message: `Test message sent to admin number (+91 ${adminNum}).` });
    }

    if (!userId) return res.status(400).json({ message: 'userId is required for this message type.' });
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (!user.phone) return res.status(400).json({ message: `${user.name} has no phone number on file.` });

    if (type === 'custom') {
      if (!message || !message.trim()) return res.status(400).json({ message: 'message is required.' });
      const result = await sendWA(user.phone, message.trim());
      if (!result.ok) return res.status(502).json({ message: `Failed to send to ${user.name}: ${result.error}` });
      return res.json({ success: true, message: `Custom message sent to ${user.name} (+91 ${user.phone}).` });
    }

    if (type === 'welcome') {
      const result = await sendWelcomeWA(user);
      if (!result.ok) return res.status(502).json({ message: `Failed to send to ${user.name}: ${result.error}` });
      return res.json({ success: true, message: `Welcome message sent to ${user.name} (+91 ${user.phone}).` });
    }

    if (type === 'plan') {
      if (!planName || !endDate) return res.status(400).json({ message: 'planName and endDate are required.' });
      const plan = { planName, startDate: startDate ? new Date(startDate) : new Date(), endDate: new Date(endDate) };
      const result = await sendPlanActivatedWA(user, plan);
      if (!result.ok) return res.status(502).json({ message: `Failed to send to ${user.name}: ${result.error}` });
      return res.json({ success: true, message: `Plan-assigned message sent to ${user.name} (+91 ${user.phone}). Note: this does NOT change their subscription in the database — use "Assign Plan" in the Users tab for that.` });
    }

    return res.status(400).json({ message: 'Unknown message type.' });
  } catch (err) {
    console.error('[Admin/whatsapp/send]', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── B2B / BULK TIFFIN LEADS (PG · hostel · office · mess) ─────────────────────
// Manage the pipeline of PG/hostel/office owners and reach out to them in bulk
// over Email (Resend) + WhatsApp (Baileys), reusing the same broadcast utilities
// as the customer broadcast tool.

// Default outreach templates (used when the admin doesn't type a custom message)
function b2bDefaultEmailHtml() {
  return (
    `We supply <strong>100% pure-vegetarian bulk tiffins</strong> (lunch &amp; dinner) to PGs, hostels and offices across Patna — cooked fresh daily in a dedicated veg kitchen, with Jain / no-onion-garlic options on request.` +
    `<br/><br/>` +
    `<strong>Why partner with SatvikMeals:</strong>` +
    `<br/>• Fixed monthly per-plate pricing — no surprises` +
    `<br/>• Reliable daily delivery (3 years, zero missed days)` +
    `<br/>• Customisable menu — with or without onion &amp; garlic` +
    `<br/>• Hygienic, home-style cooking your residents will actually eat` +
    `<br/><br/>` +
    `Can we send you a sample menu and a per-plate quote for your headcount? Reply here or WhatsApp us at +91 90314 47621.`
  );
}
function b2bDefaultWaText() {
  return (
    `🌿 *SatvikMeals — Bulk Tiffin for PGs & Hostels (Patna)*\n\n` +
    `Namaste! We supply 100% pure-veg bulk tiffins (lunch & dinner) to PGs, hostels and offices across Patna — fresh daily, Jain / no onion-garlic options available.\n\n` +
    `✅ Fixed per-plate monthly pricing\n` +
    `✅ Reliable daily delivery\n` +
    `✅ Menu customised to your residents\n\n` +
    `Can we share a sample menu + quote for your headcount?\n` +
    `📞 Call: +91 62012 76506  |  💬 WhatsApp: +91 90314 47621`
  );
}

// List / search / filter leads
router.get('/b2b-leads', async (req, res) => {
  try {
    const { q, type, status, area } = req.query;
    const query = {};
    if (type)   query.type = type;
    if (status) query.status = status;
    if (area)   query.area = { $regex: area, $options: 'i' };
    if (q) {
      query.$or = [
        { businessName: { $regex: q, $options: 'i' } },
        { ownerName:    { $regex: q, $options: 'i' } },
        { phone:        { $regex: q, $options: 'i' } },
        { email:        { $regex: q, $options: 'i' } },
      ];
    }
    const leads = await B2BLead.find(query).sort('-createdAt');
    res.json(leads);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create lead
router.post('/b2b-leads', async (req, res) => {
  try {
    res.status(201).json(await B2BLead.create(req.body));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Update lead (edit fields / change status)
router.put('/b2b-leads/:id', async (req, res) => {
  try {
    const lead = await B2BLead.findByIdAndUpdate(req.params.id, req.body, { new: true });
    lead ? res.json(lead) : res.status(404).json({ message: 'Not found' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Delete lead
router.delete('/b2b-leads/:id', async (req, res) => {
  await B2BLead.findByIdAndDelete(req.params.id);
  res.json({ message: 'Deleted' });
});

// ── B2B OUTREACH — send Email + WhatsApp to selected/filtered leads ───────────
// body: { leadIds?: [], filter?: { type, status, area }, subject?, message?, channels? }
//   - If leadIds given, target those; else target by filter (or all).
//   - channels: ['email','whatsapp'] (default both)
//   - subject/message optional → falls back to the B2B templates above.
router.post('/b2b-outreach', async (req, res) => {
  try {
    const { leadIds, filter, subject, message, channels } = req.body;

    let leads;
    if (Array.isArray(leadIds) && leadIds.length) {
      leads = await B2BLead.find({ _id: { $in: leadIds } });
    } else {
      const query = {};
      if (filter?.type)   query.type = filter.type;
      if (filter?.status) query.status = filter.status;
      if (filter?.area)   query.area = { $regex: filter.area, $options: 'i' };
      leads = await B2BLead.find(query);
    }
    if (!leads.length) return res.status(400).json({ message: 'No matching leads to contact.' });

    // Shape leads like "users" so we can reuse the broadcast utilities
    const asRecipients = leads.map(l => ({
      name:  l.ownerName || l.businessName,
      email: l.email,
      phone: l.phone,
    }));

    const ch = channels || ['email', 'whatsapp'];
    const ids = leads.map(l => l._id);

    // Respond immediately — like the customer broadcast, outreach to many leads
    // over Resend + Baileys can take minutes and must not hold the request open.
    res.json({
      success: true,
      accepted: true,
      leadCount: leads.length,
      channels: ch,
      message: `Outreach queued for ${leads.length} lead(s). Sending in the background; leads are marked contacted as it runs.`,
    });

    // ── Fire-and-forget delivery + status update ──────────────────────────────
    ;(async () => {
      const result = { email: null, whatsapp: null };
      try {
        if (ch.includes('email')) {
          const withEmail = asRecipients.filter(r => r.email);
          result.email = withEmail.length
            ? await sendBroadcastEmail(withEmail, subject || 'Bulk pure-veg tiffins for your PG / hostel — SatvikMeals', message || b2bDefaultEmailHtml())
            : { sent: 0, failed: 0, note: 'No leads with an email address.' };
        }
        if (ch.includes('whatsapp')) {
          const withPhone = asRecipients.filter(r => r.phone);
          // WhatsApp gets the plain-text template (or the custom message stripped of HTML)
          const waText = message ? message.replace(/<[^>]+>/g, '') : b2bDefaultWaText();
          result.whatsapp = withPhone.length
            ? await sendBroadcastWA(withPhone, waText)
            : { sent: 0, failed: 0, note: 'No leads with a phone number.' };
        }

        // Mark contacted — bump timestamp/count for all; only advance status for brand-new leads
        const now = new Date();
        await B2BLead.updateMany(
          { _id: { $in: ids } },
          { $set: { lastContactedAt: now }, $inc: { contactCount: 1 } }
        );
        await B2BLead.updateMany(
          { _id: { $in: ids }, status: 'new' },
          { $set: { status: 'contacted' } }
        );
        console.log(`[Admin/b2b-outreach] Done for ${leads.length} lead(s):`, result);
      } catch (e) {
        console.error('[Admin/b2b-outreach] background delivery error:', e.message);
      }
    })();
  } catch (err) {
    console.error('[Admin/b2b-outreach]', err.message);
    if (!res.headersSent) res.status(500).json({ message: err.message });
  }
});

module.exports = router;

