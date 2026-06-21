'use strict';
/**
 * SatvikMeals — Mongo-backed Baileys authentication state.
 *
 * Drop-in replacement for Baileys' built-in `useMultiFileAuthState`, but
 * persists everything to MongoDB instead of the local filesystem. This is
 * essential on Render (and similar PaaS), where the filesystem is wiped on
 * every restart/redeploy/sleep-wake cycle — a file-based session would force
 * re-scanning the QR code constantly. MongoDB persists independently of the
 * app server's lifecycle.
 *
 * Implements the same interface Baileys expects:
 *   { state: { creds, keys: { get, set } }, saveCreds, clearState }
 *
 * Buffers inside Baileys' creds/keys objects are serialized to
 * { type: 'Buffer', data: 'base64...' } so they survive the JSON round-trip,
 * then revived back into real Buffer instances on read.
 */

const WaSession = require('../models/WaSession');

// ── Buffer-safe JSON serialization ────────────────────────────────────────────
function replacer(key, value) {
  if (value && value.type === 'Buffer' && Array.isArray(value.data)) return value; // already serialized
  if (Buffer.isBuffer(value)) return { type: 'Buffer', data: value.toString('base64'), __b64: true };
  if (value instanceof Uint8Array) return { type: 'Buffer', data: Buffer.from(value).toString('base64'), __b64: true };
  return value;
}

function reviver(key, value) {
  if (value && value.__b64 && value.type === 'Buffer' && typeof value.data === 'string') {
    return Buffer.from(value.data, 'base64');
  }
  return value;
}

function serialize(obj) {
  return JSON.stringify(obj, replacer);
}

function deserialize(str) {
  return JSON.parse(str, reviver);
}

// ── Read/write helpers against the WaSession collection ──────────────────────
async function readDoc(category, keyId = null) {
  const doc = await WaSession.findOne({ category, keyId }).lean();
  if (!doc) return null;
  try {
    return deserialize(doc.data);
  } catch (e) {
    console.error(`[WaAuthState] Failed to parse stored doc (${category}/${keyId}):`, e.message);
    return null;
  }
}

async function writeDoc(category, keyId, value) {
  await WaSession.findOneAndUpdate(
    { category, keyId },
    { data: serialize(value) },
    { upsert: true }
  );
}

async function deleteDoc(category, keyId) {
  await WaSession.deleteOne({ category, keyId });
}

// ── Main export — mirrors useMultiFileAuthState's interface ──────────────────
async function useMongoAuthState() {
  // Use require (CJS) — dynamic import does not work for this CJS package
  const { initAuthCreds } = require('@whiskeysockets/baileys');

  let creds = await readDoc('creds');
  if (!creds) {
    creds = initAuthCreds();
    await writeDoc('creds', null, creds);
  }

  const keys = {
    get: async (type, ids) => {
      const result = {};
      await Promise.all(ids.map(async (id) => {
        const value = await readDoc(type, id);
        if (value !== null) result[id] = value;
      }));
      return result;
    },
    set: async (data) => {
      const tasks = [];
      for (const category in data) {
        for (const id in data[category]) {
          const value = data[category][id];
          if (value) {
            tasks.push(writeDoc(category, id, value));
          } else {
            tasks.push(deleteDoc(category, id));
          }
        }
      }
      await Promise.all(tasks);
    }
  };

  const saveCreds = async () => {
    await writeDoc('creds', null, creds);
  };

  // Wipes the entire WhatsApp session from MongoDB — used when admin
  // disconnects/logs out, so the next "Connect" shows a fresh QR code.
  const clearState = async () => {
    await WaSession.deleteMany({});
  };

  return {
    state: { creds, keys },
    saveCreds,
    clearState,
  };
}

module.exports = { useMongoAuthState };
