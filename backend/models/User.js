const mongoose = require('mongoose');
const crypto   = require('crypto');

// 8 hex chars = ~4 billion combinations, collision practically impossible
const genCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

const subscriptionSchema = new mongoose.Schema({
  planId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
  planName:  String,
  planType:  String,
  price:     { type: Number, default: 0 },  // used for monthly invoice generation
  startDate: Date,
  endDate:   Date,
  status:    { type: String, enum: ['active','paused','expired','cancelled'], default: 'active' },
  pausedAt:  Date,
  paymentId: String
}, { timestamps: true });

const referredUserSchema = new mongoose.Schema({
  email:        String,
  name:         String,
  joinedAt:     Date,
  hasPurchased: { type: Boolean, default: false },
  planName:     String,
  rewardPaid:   { type: Boolean, default: false }
});

const userSchema = new mongoose.Schema({
  name:         { type: String, required: true },
  email:        { type: String, required: true, unique: true, lowercase: true },
  googleId:     { type: String, sparse: true },
  // sparse: true means null values are excluded from the unique index
  // so multiple users without a phone number won't conflict
  phone:        {
    type: String,
    unique: true,
    sparse: true,
    validate: {
      validator: v => !v || /^[6-9]\d{9}$/.test(v),
      message: 'Invalid phone'
    }
  },
  role:          { type: String, enum: ['user','admin'], default: 'user' },
  referralCode:  { type: String, unique: true, default: genCode },
  referredBy:    { type: String, default: null },
  coins:         { type: Number, default: 0 },
  referredUsers: [referredUserSchema],
  subscriptions: [subscriptionSchema],
  location: {
    latitude:   { type: Number, default: null },
    longitude:  { type: Number, default: null },
    address:    { type: String, default: null },
    capturedAt: { type: Date,   default: null }
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
