#!/usr/bin/env node
/**
 * ensure-jwt-secrets.mjs — idempotently provision the ES256 JWT keyring.
 *
 * Runs as the LAST step of `npm run deploy` (after `wrangler deploy`, so the
 * Worker already exists and can receive secrets). Behaviour:
 *
 *   - If JWT_PRIVATE_KEY_V1 is already a secret on the Worker  -> skip (NEVER
 *     rotate; rotating on every deploy would log every user out).
 *   - Otherwise generate a fresh ES256 keypair + JWT_SECRET and `wrangler
 *     secret put` all three. Keys are generated in memory and piped straight
 *     to wrangler — they never touch disk.
 *
 * Best-effort: any failure is logged but exits 0, so a transient secrets-API
 * hiccup never marks an otherwise-successful deploy as failed. If it can't
 * provision the keys, it tells the user to run `npm run rotate:jwt` manually.
 *
 * Config resolution matches scripts/wrangler.mjs:
 *   WRANGLER_CONFIG env > wrangler.local.jsonc > wrangler.jsonc
 */
import { existsSync } from "node:fs";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

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

function jwtKeyAlreadySet() {
  // `wrangler secret list` prints a JSON array of { name, type }. Wrangler may
  // also emit warnings (e.g. the "unsafe fields" notice) on stderr, so parse
  // only stdout and locate the JSON array defensively.
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
  if (start === -1 || end === -1) return false;
  const list = JSON.parse(out.slice(start, end + 1));
  return Array.isArray(list) && list.some((s) => s && s.name === "JWT_PRIVATE_KEY_V1");
}

try {
  console.log(`→  ensure-jwt-secrets: checking existing secrets (config: ${cfg})`);
  if (jwtKeyAlreadySet()) {
    console.log("✓  JWT_PRIVATE_KEY_V1 already provisioned — skipping (keys are never rotated here).");
    process.exit(0);
  }

  console.log("→  no JWT keyring found; generating ES256 keypair + 32-byte JWT_SECRET");
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const jwtSecret = randomBytes(32).toString("hex");

  await putSecret("JWT_PRIVATE_KEY_V1", privateKey);
  await putSecret("JWT_PUBLIC_KEY_V1", publicKey);
  await putSecret("JWT_SECRET", jwtSecret);
  console.log("✓  JWT keyring provisioned (JWT_PRIVATE_KEY_V1 / JWT_PUBLIC_KEY_V1 / JWT_SECRET). JWT_CURRENT_KID=v1 is set via wrangler vars.");
  process.exit(0);
} catch (err) {
  console.warn(`⚠  Could not auto-provision JWT keys: ${err.message}`);
  console.warn("   The deploy itself succeeded. Provision the keyring once with: npm run rotate:jwt");
  process.exit(0);
}
