require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const mongoose = require('mongoose');
const path     = require('path');

const authRoutes      = require('./routes/auth');
const paymentRoutes   = require('./routes/payment');
const planRoutes      = require('./routes/plans');
const menuRoutes      = require('./routes/menu');
const userRoutes      = require('./routes/user');
const adminRoutes     = require('./routes/admin');
const orderRoutes     = require('./routes/orders');
const complaintRoutes = require('./routes/complaints');

const app = express();

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth',    authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/plans',   planRoutes);
app.use('/api/menu',    menuRoutes);
app.use('/api/user',    userRoutes);
app.use('/api/admin',   adminRoutes);
app.use('/api/orders',  orderRoutes);
app.use('/api',         complaintRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'SatvikMeals' }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Drops the old non-sparse phone_1 index if it exists, then lets
// Mongoose recreate it correctly as sparse. Safe to run every deploy.
async function fixPhoneIndex() {
  try {
    const collection = mongoose.connection.db.collection('users');
    const indexes = await collection.indexes();
    const phoneIndex = indexes.find(i => i.name === 'phone_1');

    if (phoneIndex && !phoneIndex.sparse) {
      await collection.dropIndex('phone_1');
      console.log('✅ Dropped old non-sparse phone_1 index');
    } else {
      console.log('✅ phone index is fine, no action needed');
    }

    // Let Mongoose sync the correct sparse index
    await mongoose.model('User').syncIndexes();
    console.log('✅ User indexes synced');
  } catch (err) {
    console.error('⚠️ fixPhoneIndex error (non-fatal):', err.message);
  }
}

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected');
    await fixPhoneIndex();
    app.listen(process.env.PORT || 5000, () =>
      console.log(`SatvikMeals running on port ${process.env.PORT || 5000}`)
    );
  })
  .catch(err => { console.error(err); process.exit(1); });
