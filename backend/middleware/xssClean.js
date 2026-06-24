'use strict';
/**
 * SatvikMeals — XSS prevention middleware
 * Recursively strips <script> tags, event handlers, and dangerous HTML
 * from all string values in req.body, req.query, and req.params.
 *
 * This is a lightweight, dependency-free sanitizer tuned for a JSON API
 * (no rich-text fields exist in this app, so aggressive stripping is safe).
 */

// Strips script tags, on-event attributes, javascript: URIs, and angle brackets
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*on\w+\s*=\s*["'][^"']*["'][^>]*>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/<[^>]+>/g, (match) => {
      // Allow plain text through, strip any remaining HTML tags entirely
      return '';
    });
}

function sanitizeValue(value) {
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object') {
    const clean = {};
    for (const key of Object.keys(value)) {
      clean[key] = sanitizeValue(value[key]);
    }
    return clean;
  }
  return value;
}

function xssClean() {
  return (req, res, next) => {
    try {
      if (req.body && typeof req.body === 'object') {
        req.body = sanitizeValue(req.body);
      }
      if (req.query && typeof req.query === 'object') {
        for (const key of Object.keys(req.query)) {
          req.query[key] = sanitizeValue(req.query[key]);
        }
      }
      if (req.params && typeof req.params === 'object') {
        for (const key of Object.keys(req.params)) {
          req.params[key] = sanitizeValue(req.params[key]);
        }
      }
      next();
    } catch (err) {
      console.error('[xssClean] sanitization error:', err.message);
      next(); // never block the request on a sanitizer failure
    }
  };
}

module.exports = xssClean;
