const express = require('express');
const { protect, adminOnly } = require('../middleware/auth');
const { Plan, Menu, Order, Payment } = require('../models/index');
const User = require('../models/User');
const { sendPlanActivatedEmail, sendBroadcastEmail } = require('../utils/resend');
const { Resend } = require('resend');
const { sendPlanActivatedWA, sendBroadcastWA, sendWA, connect: waConnect, disconnect: waDisconnect, getStatus: waGetStatus, getQrImage: waGetQrImage } = require('../utils/whatsapp');
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

    const result = { email: null, whatsapp: null };
    const ch = channels || ['email', 'whatsapp'];

    if (ch.includes('email') && subject) {
      result.email = await sendBroadcastEmail(users, subject, message);
    }
    if (ch.includes('whatsapp')) {
      result.whatsapp = await sendBroadcastWA(users, message);
    }

    res.json({ success: true, userCount: users.length, result });
  } catch (err) {
    console.error('[Admin/broadcast]', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── WHATSAPP SESSION MANAGEMENT ───────────────────────────────────────────────
// ── TEST MESSAGE — send to a specific phone/email ────────────────────────────
router.post('/test-message', async (req, res) => {
  try {
    const { phone, email, message, channel } = req.body;
    const result = {};

    if ((channel === 'whatsapp' || channel === 'both') && phone) {
      try {
        await sendWA(phone, message || 'Test message from SatvikMeals ✅');
        result.whatsapp = { success: true, to: phone };
        console.log(`[Test] WA sent to ${phone}`);
      } catch (e) {
        result.whatsapp = { success: false, error: e.message };
      }
    }

    if ((channel === 'email' || channel === 'both') && email) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const FROM = process.env.RESEND_FROM || 'SatvikMeals <hello@satvikmeals.in>';
        await resend.emails.send({
          from: FROM, to: email,
          subject: 'Test Email from SatvikMeals',
          html: `<p>This is a test email from SatvikMeals admin panel.</p><p>${message || 'Test message ✅'}</p>`
        });
        result.email = { success: true, to: email };
        console.log(`[Test] Email sent to ${email}`);
      } catch (e) {
        result.email = { success: false, error: e.message };
      }
    }

    res.json({ success: true, result });
  } catch (err) {
    console.error('[Test Message]', err.message);
    res.status(500).json({ message: err.message });
  }
});

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

module.exports = router;

