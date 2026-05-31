#!/usr/bin/env node
// Browser Run smoke probe — calls /api/admin/system/br-smoke and interprets
// the result. Use this before flipping `tenant_configs.enable_pdf_pipeline`
// to confirm Cloudflare Browser Run is provisioned for the account.
//
// Cross-platform (Node 18+, global fetch). Examples:
//   node scripts/br-smoke.mjs --token "$JWT"
//   node scripts/br-smoke.mjs --base-url https://api.your-domain.com --token "$JWT"
//   node scripts/br-smoke.mjs --probe-url https://api.your-domain.com/report/<tenant>/<id> --token "$JWT"
//   node scripts/br-smoke.mjs --dry-run            # wrangler binding validation only
//
// Env fallbacks: BR_SMOKE_BASE_URL, BR_SMOKE_TOKEN.

import { spawnSync } from 'node:child_process';

// ── ANSI colors (no-op when not a TTY) ───────────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  cyan: (s) => paint('36', s),
  green: (s) => paint('32', s),
  yellow: (s) => paint('33', s),
  red: (s) => paint('31', s),
};

// ── Arg parsing: supports `--flag value` and `--flag=value` ──────────────
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; }
    else { out[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const baseUrl = (args['base-url'] || process.env.BR_SMOKE_BASE_URL || 'http://localhost:8788').replace(/\/$/, '');
const token = args.token || process.env.BR_SMOKE_TOKEN || '';
const probeUrl = args['probe-url'] || 'https://example.com';
const dryRun = Boolean(args['dry-run']);

// ── Optional: wrangler dry-run binding validation ────────────────────────
if (dryRun) {
  console.log(c.cyan('==> wrangler deploy --dry-run (binding validation)'));
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const res = spawnSync(npx, ['wrangler', 'deploy', '--dry-run'], { encoding: 'utf8' });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  process.stdout.write(out);
  if (res.status !== 0) {
    console.log(c.red('wrangler dry-run failed — fix binding errors before probing BR.'));
    process.exit(1);
  }
  if (/browser/i.test(out)) console.log(c.green('[ok] dry-run mentions browser binding'));
  console.log('');
}

// ── Token required for the live probe ────────────────────────────────────
if (!token) {
  console.log(c.red('Missing --token. Pass an admin JWT (Bearer).'));
  console.log('  - Sign in via /login on the deployed API, copy the __Host-inspector_token cookie value.');
  console.log("  - Or: BR_SMOKE_TOKEN='<jwt>' node scripts/br-smoke.mjs");
  process.exit(2);
}

const url = `${baseUrl}/api/admin/system/br-smoke?url=${encodeURIComponent(probeUrl)}`;
console.log(c.cyan(`==> GET ${url}`));

let resp;
try {
  resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
} catch (err) {
  console.log(c.red(`Request failed: ${err.message}`));
  process.exit(3);
}

if (!resp.ok) {
  console.log(c.red(`HTTP ${resp.status}`));
  if (resp.status === 401) console.log(c.yellow('Hint: token expired or not an admin user.'));
  if (resp.status === 404) console.log(c.yellow("Hint: br-smoke route not deployed yet. Run 'npm run deploy' first."));
  // Still try to surface a JSON error body if present.
  try { const body = await resp.json(); if (body?.error) console.log(c.yellow(`error: ${body.error}`)); } catch { /* ignore */ }
  process.exit(3);
}

const json = await resp.json();
const d = json.data ?? {};
console.log('');
console.log(`bindingPresent : ${d.bindingPresent}`);
console.log(`probedUrl      : ${d.probedUrl}`);
console.log(`status         : ${d.status}`);
console.log(`ok             : ${d.ok}`);
console.log(`contentType    : ${d.contentType}`);
console.log(`contentLength  : ${d.contentLength} bytes`);
console.log(`durationMs     : ${d.durationMs}`);
if (d.error) console.log(c.yellow(`error          : ${d.error}`));
console.log('');
const hintColor = d.ok ? c.green : d.bindingPresent ? c.yellow : c.red;
console.log(hintColor(`hint: ${d.hint}`));

if (!d.ok) process.exit(4);
