const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  email:     { type: String, required: true },
  amount:    { type: Number, required: true },
  purpose:   { type: String, required: true },
  paymentId: { type: String },
  requestId: { type: String, required: true },
  status:    { type: String, enum: ['pending','paid','failed','refunded'], default: 'pending' },
  source:    { type: String, enum: ['cart','subscription'], required: true },
  planId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
  coinsUsed: { type: Number, default: 0 }
}, { timestamps: true });

const orderSchema = new mongoose.Schema({
  userEmail:     { type: String, required: true },
  items:         [{ name: String, quantity: Number, price: Number }],
  totalAmount:   { type: Number, required: true },
  paymentId:     { type: String },
  paymentStatus: { type: String, enum: ['pending','paid','failed'], default: 'pending' },
  paymentMethod: { type: String, default: 'instamojo' },
  planId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' }
}, { timestamps: true });

const planSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  type:        { type: String, enum: ['weekly','monthly'], required: true },
  price:       { type: Number, required: true },
  description: { type: String },
  features:    [String],
  mealType:    { type: String, enum: ['satvik','regular','both'], default: 'both' },
  meals:       { type: [String], enum: ['breakfast','lunch','dinner'], default: ['lunch','dinner'] },
  validityDays:{ type: Number, default: 30 },
  isActive:    { type: Boolean, default: true },
  sortOrder:   { type: Number, default: 0 }
}, { timestamps: true });

const dayMenuSchema = new mongoose.Schema({
  day:            { type: String, enum: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], required: true },
  breakfastItems: [String],
  lunchItems:     [String],
  dinnerItems:    [String],
  mealType:       { type: String, enum: ['satvik','regular','both'], default: 'both' }
});

const menuSchema = new mongoose.Schema({
  weekStarting: { type: Date, required: true },
  items:        [dayMenuSchema],
  publishedAt:  { type: Date }
}, { timestamps: true });

module.exports = {
  Payment: mongoose.model('Payment', paymentSchema),
  Order:   mongoose.model('Order',   orderSchema),
  Plan:    mongoose.model('Plan',    planSchema),
  Menu:    mongoose.model('Menu',    menuSchema)
};
