const express = require('express');
const { Plan } = require('../models/index');
const router = express.Router();

router.get('/', async (req, res) => {
  const plans = await Plan.find({ isActive: true }).sort('sortOrder');
  res.json(plans);
});

module.exports = router;
