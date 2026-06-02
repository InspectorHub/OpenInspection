#!/usr/bin/env node
/**
 * Seed a known test account into the LOCAL D1 so local login is reliably
 * testable. Idempotent — safe to run on every test/dev startup.
 *
 *   node scripts/seed-test-user.mjs
 *
 * Creds (override via env): TEST_EMAIL / TEST_PASSWORD
 *   default: admin@example.com / testpassword123
 *
 * Uses the same PBKDF2-SHA256 (100k iters, 16-byte salt, `pbkdf2:salt:hash`)
 * format as server/lib/password.ts, and the standalone SINGLE_TENANT_ID.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const EMAIL = process.env.TEST_EMAIL || "admin@example.com";
const PASSWORD = process.env.TEST_PASSWORD || "testpassword123";
const TENANT_ID = process.env.SINGLE_TENANT_ID || "5b0d0e5c-7d2a-4d9e-9c1f-1e2c3d4e5f6a";
const CONFIG = process.env.WRANGLER_CONFIG || "wrangler.jsonc";

const toHex = (b) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
// Escape single quotes for safe interpolation into the SQL string literals below
// (values originate from env vars — defends against SQL injection).
const sq = (s) => String(s).replace(/'/g, "''");

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, key, 256);
  return `pbkdf2:${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

const now = Date.now();
const pw = await hashPassword(PASSWORD);
const userId = "test-admin-0000-0000-0000-000000000001";

const sql = [
  // Tenant (standalone single tenant) — created once, ignored thereafter.
  `INSERT OR IGNORE INTO tenants (id, name, subdomain, created_at) VALUES ('${sq(TENANT_ID)}', 'Test Tenant', 'test', ${now});`,
  // Owner user — delete+insert so the password resets to a known value each run.
  `DELETE FROM users WHERE email = '${sq(EMAIL)}';`,
  `INSERT INTO users (id, tenant_id, email, password_hash, role, created_at) VALUES ('${userId}', '${sq(TENANT_ID)}', '${sq(EMAIL)}', '${pw}', 'owner', ${now});`,
].join("\n");

const sqlFile = join(process.cwd(), ".seed-test-user.tmp.sql");
writeFileSync(sqlFile, sql, "utf8");
try {
  // execFileSync with an argv array (no shell) — env-derived CONFIG can't inject
  // shell metacharacters. npx is npx.cmd on Windows.
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  execFileSync(npx, ["wrangler", "d1", "execute", "DB", "--local", "-c", CONFIG, "--file", sqlFile], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  // Do not log the password (clear-text logging of sensitive data).
  console.log(`✓ seeded test account: ${EMAIL} (tenant ${TENANT_ID})`);
} finally {
  rmSync(sqlFile, { force: true });
}
