const express = require('express');
const { Menu } = require('../models/index');
const router = express.Router();

router.get('/current', async (req, res) => {
  const menu = await Menu.findOne({ weekStarting: { $lte: new Date() } }).sort('-weekStarting');
  if (!menu) return res.json({ items: [] });
  res.json(menu);
});

module.exports = router;
