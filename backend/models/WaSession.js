'use strict';
/**
 * SatvikMeals — MongoDB schema for storing Baileys WhatsApp session data.
 *
 * Baileys needs to persist two kinds of data across restarts:
 *   1. `creds`     — a single JSON blob (account identity, keys, etc.)
 *   2. `keys`      — many small JSON blobs keyed by (type, id) — e.g.
 *                    pre-keys, session records, sender-keys.
 *
 * Instead of writing these to disk (which Render wipes on every restart),
 * we store every piece as a document in this single flat collection.
 * This is what makes the WhatsApp session survive redeploys and sleep/wake
 * cycles on Render.
 */

const mongoose = require('mongoose');

const waSessionSchema = new mongoose.Schema({
  // 'creds' for the single credentials blob, or the key "type" (e.g. "pre-key") for keys
  category: { type: String, required: true, index: true },
  // For keys: the specific key id within that category. Null for creds.
  keyId:    { type: String, default: null, index: true },
  // The actual data, stored as a JSON string (Baileys uses Buffers internally,
  // so we serialize/deserialize through a custom replacer/reviver — see authState.js)
  data:     { type: String, required: true },
}, { timestamps: true });

waSessionSchema.index({ category: 1, keyId: 1 }, { unique: true });

module.exports = mongoose.models.WaSession || mongoose.model('WaSession', waSessionSchema);
