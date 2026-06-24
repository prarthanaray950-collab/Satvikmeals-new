const express = require('express');
const { Order } = require('../models/index');
const { protect } = require('../middleware/auth');
const router = express.Router();

router.get('/', protect, async (req, res) => {
  const orders = await Order.find({ userEmail: req.user.email }).sort('-createdAt');
  res.json(orders);
});

module.exports = router;
