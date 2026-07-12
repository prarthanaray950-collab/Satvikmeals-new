const mongoose = require('mongoose');

// ── B2B Lead ──────────────────────────────────────────────────────────────────
// PG / hostel / office / mess owners the admin reaches out to for bulk-tiffin
// contracts. Populated manually from the admin panel (or future scraping), then
// contacted in bulk over Email (Resend) + WhatsApp (Baileys) using the existing
// broadcast utilities.
const b2bLeadSchema = new mongoose.Schema({
  businessName:   { type: String, required: true, trim: true },
  ownerName:      { type: String, trim: true },
  phone:          { type: String, trim: true },   // 10-digit or with country code; toJid() normalizes
  email:          { type: String, trim: true, lowercase: true },
  type:           { type: String, enum: ['pg','hostel','office','mess','canteen','gym','other'], default: 'pg' },
  area:           { type: String, trim: true },   // e.g. "Boring Road, Patna"
  capacity:       { type: Number, default: 0 },   // approx meals/day this lead could need
  status:         { type: String, enum: ['new','contacted','negotiating','converted','lost'], default: 'new' },
  notes:          { type: String, trim: true },
  lastContactedAt:{ type: Date },
  contactCount:   { type: Number, default: 0 },
}, { timestamps: true });

// Helpful for search + de-duplication
b2bLeadSchema.index({ businessName: 1 });
b2bLeadSchema.index({ phone: 1 });
b2bLeadSchema.index({ status: 1, type: 1, area: 1 });

module.exports = mongoose.model('B2BLead', b2bLeadSchema);
