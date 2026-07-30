#!/usr/bin/env node
/**
 * Provider / storage helper gate (`lint:provider-helpers`).
 *
 * Email, SMS, and in-app notices must go through their provider / service.
 * D1 must not be queried with raw `.prepare(` (Drizzle only). API routes must
 * obtain Drizzle via `getDrizzle` and must not touch R2 bindings directly —
 * use `server/lib/r2/objects.ts` (or a service that does).
 *
 * Two severity classes:
 *
 *   HARD (exit 1, no baseline) — new hand-rolls of a vendor send path or a
 *   notifications insert, or raw D1 SQL outside a tiny allowlist. Fix the call
 *   site; do not --update.
 *
 *   RATCHET (baseline) — pre-existing `drizzle(c.env.DB)` and `c.env.PHOTOS.*`
 *   hits in server/api. Frozen in `scripts/provider-helpers-baseline.json`.
 *   New hits fail; stale entries are informational (`--update` cleans them).
 *
 *   node scripts/check-provider-helpers.mjs
 *   node scripts/check-provider-helpers.mjs --update
 *
 * console.* is intentional — build script, not server code.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  enclosingSymbol,
  normalizeSignature,
  makeKey,
  diffBaseline,
  loadBaseline,
  writeBaseline,
} from './lib/symbol-baseline.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SERVER = join(ROOT, 'server');
const BASELINE = join(ROOT, 'scripts', 'provider-helpers-baseline.json');
const UPDATE = process.argv.includes('--update');

function walkFiles(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
      walkFiles(p, out);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

function rel(p) {
  return relative(ROOT, p).replace(/\\/g, '/');
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

function stripComments(source) {
  // Cheap: drop // line comments and /* */ blocks so allowlist comments and
  // doc examples do not trip the detector. String literals that contain the
  // patterns are rare and acceptable false positives if they do.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/(^|[^:])\/\/.*$/gm, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** @typedef {{ rule: string, file: string, line: number, snippet: string, hard: boolean }} Hit */

const hardFailures = [];
/** @type {Map<string, string>} */
const ratchetHits = new Map();

function addHard(file, source, index, rule, snippet) {
  hardFailures.push({
    rule,
    file: rel(file),
    line: lineOf(source, index),
    snippet: normalizeSignature(snippet),
    hard: true,
  });
}

function addRatchet(file, source, index, rule, snippet) {
  const r = rel(file);
  const key = makeKey(r, enclosingSymbol(source, index), `${rule}|${normalizeSignature(snippet)}`);
  ratchetHits.set(key, `${r}:${lineOf(source, index)} ${rule} — ${normalizeSignature(snippet)}`);
}

// ── HARD rules ─────────────────────────────────────────────────────────────

/** Vendor email HTTP URLs — only the adapters may speak Resend/SendGrid/… */
const EMAIL_VENDOR_RE = /https:\/\/api\.(resend|sendgrid|mailgun|postmarkapp)\.(com|net)\b/g;
const EMAIL_VENDOR_ALLOW = [
  /^server\/lib\/email\/providers\//,
];

/** Constructing TwilioClient outside the messaging adapters / resolve layer. */
const NEW_TWILIO_RE = /\bnew\s+TwilioClient\s*\(/g;
const NEW_TWILIO_ALLOW = [
  /^server\/lib\/messaging\//,
  /^server\/services\/messaging-compliance\.service\.ts$/,
];

/** Legacy Twilio-only send helper — callers must use MessagingProvider / sendOneSms. */
const SEND_TWILIO_SMS_RE = /\bsendTwilioSms\s*\(/g;
const SEND_TWILIO_SMS_ALLOW = [
  /^server\/lib\/sms\/send-sms\.ts$/,
];

/** Direct notifications table inserts — NotificationService owns the write. */
const INSERT_NOTIF_RE = /\.insert\(\s*notifications\b|insert\(\s*notifications\b/g;
const INSERT_NOTIF_ALLOW = [
  /^server\/services\/notification\.service\.ts$/,
];

/** Raw D1 SQL — Drizzle only (AGENTS.md). Tiny allowlist of pre-existing sites. */
const D1_PREPARE_RE = /\.prepare\s*\(\s*[`'"]/g;
const D1_PREPARE_ALLOW = [
  // System init / seed — raw batch OK for one-shot efficiency.
  /^server\/lib\/integration\/standalone\.ts$/,
  // Lifetime-total gauge; bound SQL, not a query builder surface yet.
  /^server\/features\/plan-quota\/guard\.ts$/,
  // Marketplace comment-library bulk import; prefer Drizzle when multi-row insert is clean.
  /^server\/services\/marketplace\.service\.ts$/,
];

// ── RATCHET rules (server/api only) ────────────────────────────────────────

const API_DRIZZLE_RE = /\bdrizzle\s*\(\s*(?:c\.env\.DB|env\.DB)\s*\)/g;
const API_R2_RE = /\b(?:c\.env|env)\.(?:PHOTOS|EXPORTS_BUCKET)\s*\.\s*(?:put|get|head|list|delete)\s*\(/g;

function isAllowed(relPath, allowList) {
  return allowList.some((re) => re.test(relPath));
}

const allFiles = walkFiles(SERVER);

for (const file of allFiles) {
  const r = rel(file);
  const raw = readFileSync(file, 'utf8');
  const source = stripComments(raw);

  // Email vendor URLs
  for (const m of source.matchAll(EMAIL_VENDOR_RE)) {
    if (isAllowed(r, EMAIL_VENDOR_ALLOW)) continue;
    addHard(file, raw, m.index, 'email-vendor-url', m[0]);
  }

  // new TwilioClient
  for (const m of source.matchAll(NEW_TWILIO_RE)) {
    if (isAllowed(r, NEW_TWILIO_ALLOW)) continue;
    addHard(file, raw, m.index, 'new-TwilioClient', m[0]);
  }

  // sendTwilioSms(
  for (const m of source.matchAll(SEND_TWILIO_SMS_RE)) {
    if (isAllowed(r, SEND_TWILIO_SMS_ALLOW)) continue;
    addHard(file, raw, m.index, 'sendTwilioSms', m[0]);
  }

  // insert(notifications)
  for (const m of source.matchAll(INSERT_NOTIF_RE)) {
    if (isAllowed(r, INSERT_NOTIF_ALLOW)) continue;
    addHard(file, raw, m.index, 'insert-notifications', m[0]);
  }

  // D1 .prepare('…')
  for (const m of source.matchAll(D1_PREPARE_RE)) {
    if (isAllowed(r, D1_PREPARE_ALLOW)) continue;
    addHard(file, raw, m.index, 'd1-prepare', m[0]);
  }

  // Ratchet: API drizzle + R2 binding
  if (r.startsWith('server/api/')) {
    for (const m of source.matchAll(API_DRIZZLE_RE)) {
      addRatchet(file, raw, m.index, 'api-drizzle-direct', m[0]);
    }
    for (const m of source.matchAll(API_R2_RE)) {
      addRatchet(file, raw, m.index, 'api-r2-binding', m[0]);
    }
  }
}

if (UPDATE) {
  writeBaseline(BASELINE, [...ratchetHits.keys()].sort());
  console.log(`Provider-helpers baseline updated (${ratchetHits.size} ratchet keys).`);
  if (hardFailures.length) {
    console.error(`\nHARD failures remain (${hardFailures.length}) — baseline update does not clear them:\n`);
    for (const h of hardFailures) {
      console.error(`  ${h.file}:${h.line} [${h.rule}] ${h.snippet}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

const baseline = loadBaseline(BASELINE);
const { violations, stale } = diffBaseline(ratchetHits, baseline);

let failed = false;

if (hardFailures.length) {
  failed = true;
  console.error('\nProvider-helpers gate FAILED (HARD — fix the call site, do not --update):\n');
  for (const h of hardFailures) {
    console.error(`  ${h.file}:${h.line} [${h.rule}] ${h.snippet}`);
  }
  console.error(`
  email-vendor-url     → use EmailProvider (server/lib/email/providers/*) or EmailService
  new-TwilioClient     → use loadProviderForTenant / MessagingProvider (server/lib/messaging)
  sendTwilioSms        → use sendOneSms or provider.sendMessage (not the Twilio-only helper)
  insert-notifications → use NotificationService (c.var.services.notification)
  d1-prepare           → use Drizzle via getDrizzle / service getDrizzle() — no raw SQL
`);
}

if (violations.length) {
  failed = true;
  console.error('\nProvider-helpers gate FAILED (NEW ratchet hits — route through the helper):\n');
  for (const key of violations) {
    console.error(`  ${ratchetHits.get(key)}`);
  }
  console.error(`
  api-drizzle-direct → import { getDrizzle } from '../../lib/route-helpers'
  api-r2-binding     → use server/lib/r2/objects.ts (r2Put/r2Get/…) or a service that does
`);
}

if (stale.length) {
  console.log(`Provider-helpers: ${stale.length} stale baseline key(s) — run with --update to prune.`);
}

if (failed) process.exit(1);
console.log(
  `Provider-helpers gate: OK (${ratchetHits.size} baselined API hits; ${hardFailures.length} hard).`,
);
