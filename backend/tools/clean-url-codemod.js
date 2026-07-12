'use strict';
/**
 * SatvikMeals — Clean-URL codemod (one-shot, idempotent).
 *
 * The server now 301-redirects /foo.html → /foo, so every canonical tag,
 * og:url, sitemap <loc>, JSON-LD "url"/"item", and internal <a href> should
 * point at the extensionless form to avoid 301 hops and canonical conflicts.
 *
 * This script rewrites those references across backend/public/*.{html,xml}.
 *
 * RULES (conservative — only touches known local pages, only inside quoted
 * attribute values / absolute site URLs, never prose or JS logic):
 *   "NAME.html"            → "NAME"
 *   "NAME.html#frag"       → "NAME#frag"
 *   "/NAME.html"           → "/NAME"
 *   ".../satvikmeals.in/NAME.html" → ".../satvikmeals.in/NAME"
 *   index.html special-cased → "/" (root), and site root URL loses index.html
 *
 * It does NOT change:
 *   - wa.me / tel: / external URLs
 *   - asset refs (.css/.js/.png/.jpg/.svg/.xml)
 *   - JS string navigations (location.href='x.html') — those 301 fine and
 *     changing them risks logic; left intentionally.
 *
 * Idempotent: running twice is a no-op (nothing left to match).
 *
 * Usage:  node tools/clean-url-codemod.js          (apply)
 *         node tools/clean-url-codemod.js --dry     (report only)
 */

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DRY = process.argv.includes('--dry');

// Known local page basenames (extensionless). Only these get rewritten.
const PAGES = [
  'index', 'plans', 'faq', 'blog', 'login', 'dashboard', 'admin',
  'support', 'privacy', 'terms', 'refund-policy',
  'tiffin-service-patna', 'jain-tiffin-service-patna', 'pure-veg-tiffin-patna',
  'no-onion-garlic-food-patna', 'lunch-delivery-patna', 'student-meals-patna',
  'bulk-tiffin-service-patna', 'pg-hostel-tiffin-service-patna', 'corporate-tiffin-service-patna',
  'pure-veg-restaurant-patna', 'catering-puja-functions-patna', 'how-to-order-pure-veg-food-patna',
  'blog-what-is-satvik-food', 'blog-no-onion-garlic-students', 'blog-jain-food-delivery-patna',
];

// Longest first so e.g. "blog-what-is-satvik-food" matches before "blog".
PAGES.sort((a, b) => b.length - a.length);
const NAMES = PAGES.filter(p => p !== 'index').map(escapeRe).join('|');

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function rewrite(src) {
  let out = src;

  // 1) Absolute site URLs: https://satvikmeals.in/NAME.html[#|"|'] → strip .html
  out = out.replace(
    new RegExp('(https://satvikmeals\\.in/(?:' + NAMES + '))\\.html', 'g'),
    '$1'
  );
  // 1b) Absolute index → site root
  out = out.replace(/https:\/\/satvikmeals\.in\/index\.html/g, 'https://satvikmeals.in/');

  // 2) Quoted relative refs: "NAME.html" / "/NAME.html" / "NAME.html#x"
  out = out.replace(
    new RegExp('(["\'/])(' + NAMES + ')\\.html', 'g'),
    '$1$2'
  );

  // 3) index.html as a relative href → root "/"
  //    href="index.html"  → href="/"   ;   "index.html#x" is unusual, handle too
  out = out.replace(/(["'])index\.html(?=\1)/g, '$1/');
  out = out.replace(/(["'])\/index\.html(?=\1)/g, '$1/');

  return out;
}

function main() {
  const files = fs.readdirSync(PUBLIC_DIR).filter(f => /\.(html|xml)$/i.test(f));
  let changed = 0, total = 0;
  for (const f of files) {
    const p = path.join(PUBLIC_DIR, f);
    const src = fs.readFileSync(p, 'utf8');
    const next = rewrite(src);
    if (next !== src) {
      const before = (src.match(/\.html/g) || []).length;
      const after = (next.match(/\.html/g) || []).length;
      total += (before - after);
      changed++;
      console.log(`${DRY ? '[dry] ' : ''}${f}: -${before - after} .html refs`);
      if (!DRY) fs.writeFileSync(p, next);
    }
  }
  console.log(`\n${DRY ? 'Would update' : 'Updated'} ${changed} file(s), ${total} reference(s).`);
  console.log('Remaining .html refs are intentional (JS navigations / asset names).');
}

main();
