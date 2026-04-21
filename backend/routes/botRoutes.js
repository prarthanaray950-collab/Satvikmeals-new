// backend/routes/botRoutes.js
// Then in server.js add: app.use('/api/bot', require('./routes/botRoutes'));
// And in website .env add: BOT_SECRET=satvikbot_secret_2024

const express = require('express');
const router  = express.Router();
const { Order, Plan, Menu, Payment } = require('../models/index');
const User = require('../models/User');

const botAuth = (req, res, next) => {
  const secret = process.env.BOT_SECRET;
  if (!secret) return res.status(500).json({ error: 'BOT_SECRET not set on server' });
  if (req.headers['x-bot-secret'] !== secret) return res.status(401).json({ error: 'Unauthorized' });
  next();
};
router.use(botAuth);

// GET /api/bot/orders?phone=9876543210
router.get('/orders', async (req, res) => {
  try {
    const { phone, status, limit = 50 } = req.query;
    const query = {};
    if (phone)  query.phoneNumber = { $regex: phone.replace(/^91/, ''), $options: 'i' };
    if (status) query.paymentStatus = status;
    const orders = await Order.find(query).sort({ createdAt: -1 }).limit(parseInt(limit));
    res.json({ orders, count: orders.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/bot/orders
router.post('/orders', async (req, res) => {
  try {
    const { phoneNumber, customerName, address, items, totalAmount, source } = req.body;
    const cleanedPhone = String(phoneNumber || '').replace(/^91/, '').replace(/\D/g, '').slice(-10);
    const user = await User.findOne({ phone: cleanedPhone });
    const order = await Order.create({
      userEmail:       user?.email || `${cleanedPhone}@whatsapp.bot`,
      customerName,
      phoneNumber:     cleanedPhone,
      deliveryAddress: address,
      items:           items || [],
      totalAmount:     totalAmount || 0,
      paymentStatus:   'pending',
      paymentMethod:   'upi_manual',
      source:          source || 'whatsapp_bot',
    });
    res.status(201).json({ success: true, order });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/bot/orders/:id
router.patch('/orders/:id', async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
    if (!order) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, order });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/bot/users?phone=9876543210
router.get('/users', async (req, res) => {
  try {
    const { phone, email } = req.query;
    const query = {};
    if (phone) query.phone = phone.replace(/^91/, '').replace(/\D/g, '').slice(-10);
    if (email) query.email = email.toLowerCase();
    const users = await User.find(query).select('-__v').limit(5);
    res.json({ users, count: users.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/bot/users — find or create
router.post('/users', async (req, res) => {
  try {
    const { name, phone, email, source } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
    const cleanedPhone = String(phone).replace(/^91/, '').replace(/\D/g, '').slice(-10);
    let user = await User.findOne({ phone: cleanedPhone });
    if (!user && email) user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      if (!user.phone) { user.phone = cleanedPhone; await user.save(); }
      return res.json({ success: true, user, alreadyExists: true });
    }
    user = await User.create({
      name:  name.trim(),
      email: email || `wa_${cleanedPhone}@satvikmeals.bot`,
      phone: cleanedPhone,
    });
    res.status(201).json({ success: true, user, alreadyExists: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/bot/users/:id
router.patch('/users/:id', async (req, res) => {
  try {
    const { password, role, ...safe } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { $set: safe }, { new: true }).select('-__v');
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/bot/subscriptions
router.post('/subscriptions', async (req, res) => {
  try {
    const { phoneNumber, customerName, planName, address, source } = req.body;
    const cleanedPhone = String(phoneNumber || '').replace(/^91/, '').replace(/\D/g, '').slice(-10);
    const plan = await Plan.findOne({ name: { $regex: planName, $options: 'i' }, isActive: true });
    const user = await User.findOne({ phone: cleanedPhone });
    if (user && plan) {
      await User.findByIdAndUpdate(user._id, {
        $push: { subscriptions: { planId: plan._id, planName, planType: plan.type, status: 'pending' } }
      });
    }
    res.status(201).json({ success: true, planFound: !!plan, userFound: !!user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/bot/complaint — forward to Telegram
router.post('/complaint', async (req, res) => {
  try {
    const { phoneNumber, name, type, issue } = req.body;
    const { sendTelegramMessage } = require('../utils/telegram');
    await sendTelegramMessage(
      `${(type || 'COMPLAINT').toUpperCase()} (WhatsApp Bot)\n\nFrom: ${name || 'Unknown'}\nPhone: ${phoneNumber}\n\n${issue}`
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/bot/menu
router.post('/menu', async (req, res) => {
  try { res.status(201).json({ success: true, menu: await Menu.create(req.body) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/bot/menu/:id
router.patch('/menu/:id', async (req, res) => {
  try {
    const menu = await Menu.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
    if (!menu) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, menu });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/bot/plans
router.post('/plans', async (req, res) => {
  try { res.status(201).json({ success: true, plan: await Plan.create(req.body) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/bot/plans/:id
router.patch('/plans/:id', async (req, res) => {
  try {
    const plan = await Plan.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
    if (!plan) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, plan });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/bot/admin/stats
router.get('/admin/stats', async (req, res) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const [totalUsers, newUsersToday, totalOrders, ordersToday, revenueData, activePlans] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: today } }),
      Order.countDocuments({ paymentStatus: 'paid' }),
      Order.countDocuments({ paymentStatus: 'paid', createdAt: { $gte: today } }),
      Payment.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Plan.countDocuments({ isActive: true }),
    ]);
    res.json({ totalUsers, newUsersToday, totalOrders, ordersToday, totalRevenue: revenueData[0]?.total || 0, activePlans });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
