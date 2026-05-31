#!/usr/bin/env node
/**
 * ensure-jwt-secrets.mjs — idempotently provision the ES256 JWT keyring.
 *
 * Runs as the LAST step of `npm run deploy` (after `wrangler deploy`, so the
 * Worker already exists and can receive secrets). For each secret it only
 * sets the ones that are MISSING — it never overwrites a value you already
 * provisioned (e.g. a JWT_SECRET you typed into the deploy wizard), and it
 * NEVER rotates an existing keypair (rotating on every deploy would log every
 * user out — use `npm run rotate:jwt` for deliberate rotation).
 *
 *   - JWT_PRIVATE_KEY_V1 / JWT_PUBLIC_KEY_V1 missing -> generate one ES256
 *     keypair and put both (they must be a matched pair).
 *   - JWT_SECRET missing -> put a random 32-byte hex value.
 *   - all present -> skip.
 *
 * Keys are generated in memory and piped straight to wrangler — never on disk.
 * Best-effort: any failure is logged but exits 0, so a transient secrets-API
 * hiccup never marks an otherwise-successful deploy as failed; it points the
 * user at `npm run rotate:jwt` as the manual fallback. JWT_CURRENT_KID=v1 is a
 * wrangler var, so it is always present.
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

/** Names of secrets already set on the Worker (parsed from `wrangler secret list`). */
function existingSecretNames() {
  // `wrangler secret list` prints a JSON array of { name, type }. Wrangler may
  // also emit warnings (e.g. the "unsafe fields" notice), so locate the JSON
  // array defensively rather than parsing the whole stream.
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
  console.log(`→  ensure-jwt-secrets: checking existing secrets (config: ${cfg})`);
  const have = existingSecretNames();

  if (have.has("JWT_PRIVATE_KEY_V1")) {
    console.log("✓  JWT_PRIVATE_KEY_V1 already provisioned — keypair left untouched (never rotated here).");
  } else {
    console.log("→  no JWT keypair found; generating an ES256 (P-256) keypair");
    const { publicKey, privateKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    await putSecret("JWT_PRIVATE_KEY_V1", privateKey);
    await putSecret("JWT_PUBLIC_KEY_V1", publicKey);
    console.log("✓  set JWT_PRIVATE_KEY_V1 / JWT_PUBLIC_KEY_V1 (JWT_CURRENT_KID=v1 is a wrangler var).");
  }

  if (have.has("JWT_SECRET")) {
    console.log("✓  JWT_SECRET already provisioned — left untouched.");
  } else {
    await putSecret("JWT_SECRET", randomBytes(32).toString("hex"));
    console.log("✓  set JWT_SECRET (random 32-byte hex).");
  }

  process.exit(0);
} catch (err) {
  console.warn(`⚠  Could not auto-provision JWT secrets: ${err.message}`);
  console.warn("   The deploy itself succeeded. Provision the keyring once with: npm run rotate:jwt");
  process.exit(0);
}
