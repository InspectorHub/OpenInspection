#!/usr/bin/env node
/**
 * ensure-setup-code.mjs — idempotently provision the first-run SETUP_CODE secret.
 *
 * Runs as the LAST step of `npm run deploy` (after `wrangler deploy`, so the
 * Worker already exists and can receive secrets), right alongside
 * ensure-jwt-secrets.mjs. First-run `/setup` is gated SOLELY on the SETUP_CODE
 * secret (server reads `c.env.SETUP_CODE` and fails closed when it is unset), so
 * a fresh CLI deploy needs a value or the operator can never create the first
 * admin.
 *
 *   - SETUP_CODE already set -> skip (NEVER overwrite — respects a value typed
 *     into the one-click deploy wizard or a `wrangler secret put SETUP_CODE`).
 *   - SETUP_CODE missing -> generate a random code, put it, and PRINT it once so
 *     the operator can enter it at /setup.
 *
 * The code is any string >= 6 chars (no digit/charset constraint — the server
 * compares it for exact equality). Best-effort: any failure is logged but exits
 * 0 so a transient secrets-API hiccup never fails an otherwise-good deploy.
 *
 * In a Cloudflare Workers Build (the one-click "Deploy to Cloudflare" flow, where
 * WORKERS_CI=1 is set) SETUP_CODE is owned by the deploy wizard's secret field
 * (sourced from .dev.vars.example). We skip entirely there so this step can
 * never race with — or print a value that contradicts — the wizard's value.
 *
 * Config resolution matches scripts/wrangler.mjs:
 *   WRANGLER_CONFIG env > wrangler.local.jsonc > wrangler.jsonc
 */
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

if (process.env.WORKERS_CI) {
  console.log("→  ensure-setup-code: Cloudflare Workers Build detected (WORKERS_CI) — SETUP_CODE is managed by the deploy wizard; skipping.");
  process.exit(0);
}

const cfg =
  process.env.WRANGLER_CONFIG ||
  (existsSync("wrangler.local.jsonc") ? "wrangler.local.jsonc" : "wrangler.jsonc");

const isWin = process.platform === "win32";
const npx = isWin ? "npx.cmd" : "npx";

function putSecret(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn(npx, ["wrangler", "secret", "put", name, "-c", cfg], {
      stdio: ["pipe", "inherit", "inherit"],
      shell: isWin,
    });
    child.stdin.write(value);
    child.stdin.end();
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${name}: wrangler exit ${code}`)),
    );
    child.on("error", reject);
  });
}

/** Names of secrets already set on the Worker (parsed from `wrangler secret list`). */
function existingSecretNames() {
  const r = spawnSync(npx, ["wrangler", "secret", "list", "-c", cfg], {
    encoding: "utf8",
    shell: isWin,
  });
  if (r.status !== 0) {
    throw new Error(`secret list failed (exit ${r.status}): ${(r.stderr || "").trim().slice(0, 300)}`);
  }
  const out = r.stdout || "";
  const start = out.indexOf("[");
  const end = out.lastIndexOf("]");
  if (start === -1 || end === -1) return new Set();
  const list = JSON.parse(out.slice(start, end + 1));
  return new Set(Array.isArray(list) ? list.map((s) => s && s.name) : []);
}

try {
  console.log(`→  ensure-setup-code: checking existing secrets (config: ${cfg})`);
  const have = existingSecretNames();

  if (have.has("SETUP_CODE")) {
    console.log("✓  SETUP_CODE already provisioned — left untouched (set via the deploy wizard or `wrangler secret put SETUP_CODE`).");
    process.exit(0);
  }

  // 8 hex chars (>= 6 required). Strong enough for a one-time gate on an obscure
  // workers.dev URL; the operator can override with their own value any time.
  const code = randomBytes(4).toString("hex");
  await putSecret("SETUP_CODE", code);

  console.log("");
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log(`║  🔑 Setup code: ${code.padEnd(38)}║`);
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("   Enter it at /setup to create your first admin account.");
  console.log("   Change it any time with: wrangler secret put SETUP_CODE");
  console.log("");
  process.exit(0);
} catch (err) {
  console.warn(`⚠  Could not auto-provision SETUP_CODE: ${err.message}`);
  console.warn("   The deploy itself succeeded. Set one manually with: wrangler secret put SETUP_CODE");
  process.exit(0);
}
