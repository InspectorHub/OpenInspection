#!/usr/bin/env node
/**
 * Notification dispatch gate (`lint:notification-dispatch`).
 *
 * `lint:provider-helpers` guards the TRANSPORT — that email goes through an
 * EmailProvider and SMS through a MessagingProvider. Transport was never the
 * problem. Everything above it was:
 *
 *   - a route that builds its own HTML sends real mail that is not branded,
 *     not editable, not translatable, and — the part that matters here —
 *     arrives at the boundary with no name, so no preference can ever apply
 *     to it;
 *   - a second copy of the SMS gate chain does not BYPASS the gates, it just
 *     has whichever ones someone remembered to copy. That is not a theory:
 *     the STOP-revocation check landed in one of three copies, and the other
 *     two went on texting numbers that had opted out.
 *
 * Both were found by hand-auditing call sites, twice, and the second audit
 * found what the first structurally could not (it swept routes; the miss was
 * inside a service). A third audit would miss the next one. So the rules are
 * here instead.
 *
 * Every rule is HARD — there is no baseline. Each one is currently at zero,
 * and the point is to keep it there: a baseline would let the next one in and
 * call it pre-existing.
 *
 *   node scripts/check-notification-dispatch.mjs
 *
 * console.* is intentional — build script, not server code.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SERVER = join(ROOT, 'server');

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

const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/** Drop comments so prose describing a pattern does not trip the detector. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/(^|[^:])\/\/.*$/gm, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/**
 * The argument text of a call starting at `openParenIdx`, paren-balanced.
 * Good enough for "does this call name a class" — nested calls and object
 * literals are included, which is what we want.
 */
function callArgs(source, openParenIdx) {
  let depth = 0;
  for (let i = openParenIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return source.slice(openParenIdx + 1, i);
    }
  }
  return source.slice(openParenIdx + 1);
}

const failures = [];
const add = (file, raw, index, rule, snippet) =>
  failures.push({ rule, file: rel(file), line: lineOf(raw, index), snippet });

// ── Rule 1: routes must not hand-build notification HTML ───────────────────
// Before P3 three sends did this. Each shipped a hardcoded button colour that
// ignored the company's own, and none of them could be edited or translated.
// Routes now name a service method; the service renders the template.
const HTML_IN_ROUTE_RE = /<(?:div|p|a|table|td|tr|span|h1|h2)\b[^>]*(?:\s(?:style|href|class)=)/g;
const HTML_IN_ROUTE_ALLOW = [
  // Renders the signed agreement DOCUMENT (print / PDF surface), not an email.
  // It is the artifact itself, so there is no template to route it through.
  /^server\/api\/agreements-render\.ts$/,
];

// ── Rule 2: a send must say what it is ─────────────────────────────────────
// `sendEmail(to, subject, html)` carries an address and a string. A preference
// check placed at the boundary has nothing to match against: "an email to
// jane@x.com" cannot be compared to "Jane muted review requests".
const SEND_EMAIL_RE = /\.sendEmail\s*\(/g;
const SEND_EMAIL_ALLOW = [
  // The email service layer itself — `sendRendered` supplies the class from
  // the RenderResult, and `sendEmail` is the boundary being annotated.
  /^server\/services\/email\//,
  /^server\/lib\/email\//,
  // The tenant-configured automation RULES layer. Its class model is a real
  // open question (a rule's template is tenant-authored, so there is no fixed
  // class id) and V2 decides it. Inventing one here would prejudge that, and a
  // wrong class is worse than a stated absence.
  /^server\/services\/automation\/deliver-email\.ts$/,
  /^server\/lib\/automation-core\/deliver\.ts$/,
];

// ── Rule 3: no SMS send without consulting the gate ────────────────────────
const SEND_MESSAGE_RE = /\.sendMessage\s*\(/g;
const SEND_MESSAGE_ALLOW = [
  // The provider adapters ARE the transport — they are what the gate protects.
  /^server\/lib\/messaging\//,
  /^server\/lib\/sms\/send-sms\.ts$/,
];

// ── Rule 4: exactly one copy of the gate chain ─────────────────────────────
// Reaching for `managedSendAllowed` outside the shared gate is how a second
// chain starts: one gate looks like enough until the next one is added
// somewhere else.
const MANAGED_GATE_RE = /\bmanagedSendAllowed\s*\(/g;
const MANAGED_GATE_ALLOW = [
  /^server\/lib\/sms\/managed-send-gate\.ts$/,
  /^server\/lib\/sms\/send-gate\.ts$/,
];

const allowed = (r, list) => list.some((re) => re.test(r));

for (const file of walkFiles(SERVER)) {
  const r = rel(file);
  const raw = readFileSync(file, 'utf8');
  const source = stripComments(raw);

  if (r.startsWith('server/api/') && !allowed(r, HTML_IN_ROUTE_ALLOW)) {
    for (const m of source.matchAll(HTML_IN_ROUTE_RE)) {
      add(file, raw, m.index, 'route-builds-html', m[0].slice(0, 60));
    }
  }

  if (!allowed(r, SEND_EMAIL_ALLOW)) {
    for (const m of source.matchAll(SEND_EMAIL_RE)) {
      const args = callArgs(source, m.index + m[0].length - 1);
      if (!/\bclassId\s*:/.test(args)) {
        add(file, raw, m.index, 'unclassified-send', '.sendEmail( … ) with no classId');
      }
    }
  }

  if (!allowed(r, SEND_MESSAGE_ALLOW)) {
    for (const m of source.matchAll(SEND_MESSAGE_RE)) {
      if (!/\bsmsSendGate\b/.test(source)) {
        add(file, raw, m.index, 'sms-send-without-gate', '.sendMessage( — file never calls smsSendGate');
      }
    }
  }

  if (!allowed(r, MANAGED_GATE_ALLOW)) {
    for (const m of source.matchAll(MANAGED_GATE_RE)) {
      add(file, raw, m.index, 'second-gate-chain', 'managedSendAllowed( outside the shared gate');
    }
  }
}

if (failures.length) {
  console.error('\nNotification-dispatch gate FAILED (no baseline — fix the call site):\n');
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line} [${f.rule}] ${f.snippet}`);
  }
  console.error(`
  route-builds-html     → add a registry template (server/lib/email-templates/catalog/)
                          and a method on the EmailService; the route passes facts, not markup
  unclassified-send     → prefer sendRendered(), which takes the class from the rendered
                          template; otherwise pass { classId } from server/lib/notifications/classes.ts
  sms-send-without-gate → call smsSendGate({ …, purpose }) first — see server/lib/sms/send-gate.ts
  second-gate-chain     → do not rebuild the chain; smsSendGate owns it, and a copy only
                          carries the gates someone remembered to add to it
`);
  process.exit(1);
}

console.log('Notification-dispatch gate: OK (0 unclassified sends, 0 route-built HTML, 1 gate chain).');
