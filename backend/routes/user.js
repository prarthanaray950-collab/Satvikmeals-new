const express     = require('express');
const User        = require('../models/User');
const { protect } = require('../middleware/auth');

const router = express.Router();

// GET /api/user/dashboard
router.get('/dashboard', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-__v');
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json(user);
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// PATCH /api/user/location
router.patch('/location', protect, async (req, res) => {
  try {
    const { latitude, longitude, address } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { location: { latitude, longitude, address, capturedAt: new Date() } },
      { new: true }
    );
    res.json({ message: 'Location updated.', location: user.location });
  } catch (err) {
    console.error('Location update error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// POST /api/user/subscription/:id/pause
router.post('/subscription/:id/pause', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const sub = user.subscriptions.id(req.params.id);
    if (!sub) return res.status(404).json({ message: 'Subscription not found.' });
    if (sub.status !== 'active') return res.status(400).json({ message: 'Only active subscriptions can be paused.' });

    sub.status   = 'paused';
    sub.pausedAt = new Date();
    await user.save();

    res.json({ message: 'Subscription paused.', subscription: sub });
  } catch (err) {
    console.error('Pause error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// POST /api/user/subscription/:id/resume
router.post('/subscription/:id/resume', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const sub = user.subscriptions.id(req.params.id);
    if (!sub) return res.status(404).json({ message: 'Subscription not found.' });
    if (sub.status !== 'paused') return res.status(400).json({ message: 'Only paused subscriptions can be resumed.' });

    if (sub.pausedAt) {
      const pausedMs = Date.now() - new Date(sub.pausedAt).getTime();
      sub.endDate = new Date(new Date(sub.endDate).getTime() + pausedMs);
    }
    sub.status   = 'active';
    sub.pausedAt = undefined;
    await user.save();

    res.json({ message: 'Subscription resumed.', subscription: sub });
  } catch (err) {
    console.error('Resume error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
