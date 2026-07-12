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

// ── Session namespace ("which folder") ────────────────────────────────────────
// The Baileys session is stored in MongoDB, keyed by (category, keyId). We
// prefix every category with a namespace so the whole session can be rotated
// with a single switch: point WA_SESSION_ID at a new value and the app can no
// longer see the old (possibly compromised/stuck) session — connect() then
// finds no creds and shows a fresh QR. Legacy sessions written before this
// change used un-prefixed categories, so simply deploying this file already
// starts a clean session and forces a new QR.
//
// To rotate again later, set a new value in the environment, e.g.
//   WA_SESSION_ID=v3   (or s3, patna-2, etc.)
//
// Default bumped v1 -> v2 to abandon a compromised/stuck session: the old
// 'v1:*' (and any legacy un-prefixed) docs become invisible to the app, so the
// next connect() finds no creds and shows a fresh QR instead of trying to
// resume the dead session. Force Reset in the admin panel additionally wipes
// every namespace from MongoDB.
const SESSION_NS = String(process.env.WA_SESSION_ID || 'v2').trim() || 'v2';
function nsCat(category) { return `${SESSION_NS}:${category}`; }
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ── Buffer-safe JSON serialization ────────────────────────────────────────────
// CRITICAL: Node's Buffer has a built-in toJSON() that JSON.stringify calls
// BEFORE this replacer ever sees the value — it silently converts every
// Buffer into a plain {type:'Buffer', data:[<array of byte numbers>]}
// object first. So `Buffer.isBuffer(value)` below NEVER actually fires for
// nested Buffers (e.g. creds.noiseKey.private) — by the time we see them
// they're already that plain object shape. The old version of this file
// detected that shape and returned it UNCHANGED, assuming it was already
// "serialized" — but it wasn't tagged with __b64, so the reviver could
// never turn it back into a real Buffer. That produced silent corruption:
// every noise/identity/signed key got stored as a plain JS object instead
// of a Buffer, which crashed deep inside Baileys' crypto code with
// "data argument must be of type string or Buffer... Received Object."
function replacer(key, value) {
  // This is the shape Buffer.prototype.toJSON() produces automatically —
  // re-encode it properly as compact base64 with our __b64 marker.
  if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
    return { type: 'Buffer', data: Buffer.from(value.data).toString('base64'), __b64: true };
  }
  // Uint8Array has no built-in toJSON, so it reaches us as a real Uint8Array.
  if (value instanceof Uint8Array) {
    return { type: 'Buffer', data: Buffer.from(value).toString('base64'), __b64: true };
  }
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
  const doc = await WaSession.findOne({ category: nsCat(category), keyId }).lean();
  if (!doc) return null;
  try {
    const value = deserialize(doc.data);
    if (hasCorruptedBuffers(value)) {
      console.error(`[WaAuthState] Detected corrupted (non-Buffer) key data for ${nsCat(category)}/${keyId} — discarding so Baileys treats it as missing instead of crashing.`);
      await WaSession.deleteOne({ category: nsCat(category), keyId }).catch(() => {});
      return null;
    }
    return value;
  } catch (e) {
    console.error(`[WaAuthState] Failed to parse stored doc (${nsCat(category)}/${keyId}):`, e.message);
    return null;
  }
}

// Recursively checks for the tell-tale shape of a Buffer that failed to
// revive properly: {type:'Buffer', data:[...]} without our __b64 marker
// (i.e. exactly the corruption this file used to produce before the fix
// above). If found anywhere in the value, the whole entry is considered
// unsafe to hand to Baileys.
function hasCorruptedBuffers(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (value.type === 'Buffer' && Array.isArray(value.data) && !value.__b64) return true;
  if (Array.isArray(value)) return value.some(v => hasCorruptedBuffers(v, depth + 1));
  return Object.values(value).some(v => hasCorruptedBuffers(v, depth + 1));
}

async function writeDoc(category, keyId, value) {
  await WaSession.findOneAndUpdate(
    { category: nsCat(category), keyId },
    { data: serialize(value) },
    { upsert: true }
  );
}

async function deleteDoc(category, keyId) {
  await WaSession.deleteOne({ category: nsCat(category), keyId });
}

// ── Session lifecycle helpers (namespace-aware) ──────────────────────────────
// True if a credentials blob exists for the CURRENT namespace.
async function hasExistingSession() {
  return !!(await WaSession.findOne({ category: nsCat('creds') }).lean());
}
// Wipe only the current namespace's docs.
async function clearSession() {
  const res = await WaSession.deleteMany({ category: { $regex: `^${escapeRegex(SESSION_NS)}:` } });
  return res.deletedCount || 0;
}
// Nuke every WhatsApp session doc across ALL namespaces (used by force-reset).
async function clearAllSessions() {
  const res = await WaSession.deleteMany({});
  return res.deletedCount || 0;
}

// ── Main export — mirrors useMultiFileAuthState's interface ──────────────────
async function useMongoAuthState() {
  // Lazily require so this file can be imported even before Baileys is installed
  const { initAuthCreds, BufferJSON } = await import('@whiskeysockets/baileys');

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

  // Wipes THIS namespace's WhatsApp session from MongoDB — used when admin
  // disconnects/logs out, so the next "Connect" shows a fresh QR code.
  const clearState = async () => {
    await clearSession();
  };

  return {
    state: { creds, keys },
    saveCreds,
    clearState,
  };
}

module.exports = {
  useMongoAuthState,
  hasExistingSession,
  clearSession,
  clearAllSessions,
  SESSION_NS,
};
