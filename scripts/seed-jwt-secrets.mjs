// One-shot generator: produces ES256 keypair + JWT_SECRET random,
// pipes each straight into `wrangler secret put` without touching disk.
//
// Usage: node scripts/seed-jwt-secrets.mjs <wrangler-config>
// Example: node scripts/seed-jwt-secrets.mjs wrangler.standalone.toml

import { generateKeyPairSync, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const configFile = process.argv[2];
if (!configFile) {
    console.error("Usage: node scripts/seed-jwt-secrets.mjs <wrangler-config>");
    process.exit(1);
}

function putSecret(name, value) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.platform === "win32" ? "npx.cmd" : "npx",
            ["wrangler", "secret", "put", name, "-c", configFile],
            {
                stdio: ["pipe", "inherit", "inherit"],
                shell: process.platform === "win32",
            },
        );
        child.stdin.write(value);
        child.stdin.end();
        child.on("close", (code) =>
            code === 0 ? resolve() : reject(new Error(`${name}: wrangler exit ${code}`)),
        );
        child.on("error", reject);
    });
}

console.log("→  generating ES256 keypair + 32-byte JWT_SECRET");
const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const jwtSecret = randomBytes(32).toString("hex");

console.log(`→  putting JWT_PRIVATE_KEY_V1 (${privateKey.split("\n").length} lines, PKCS8 PEM)`);
await putSecret("JWT_PRIVATE_KEY_V1", privateKey);

console.log(`→  putting JWT_PUBLIC_KEY_V1 (${publicKey.split("\n").length} lines, SPKI PEM)`);
await putSecret("JWT_PUBLIC_KEY_V1", publicKey);

console.log(`→  putting JWT_SECRET (${jwtSecret.length}-char hex)`);
await putSecret("JWT_SECRET", jwtSecret);

console.log("✓  all 3 JWT secrets put. keys never touched disk.");
