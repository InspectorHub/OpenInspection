/**
 * Derivation of the `__session` cookie signing secret from `JWT_SECRET`.
 *
 * Extracted from `session.server.ts` so that an operator-facing script can
 * compute the SAME value offline without importing the React Router session
 * machinery. There must only ever be ONE implementation of this: the whole
 * point of provisioning `SESSION_SECRET` is that the explicit value is
 * byte-identical to what this function produces, so that existing cookies keep
 * verifying. A second copy that drifts by one byte logs every user out.
 *
 * Deliberately dependency-free (Web Crypto + TextEncoder only) so it runs
 * unchanged in workerd, in Node via `tsx`, and in tests.
 *
 * COST: PBKDF2 at 100k iterations is tens of milliseconds. Callers must
 * memoise. Better still, provision `SESSION_SECRET` so this never runs in
 * production at all — see `scripts/derive-session-secret.ts`.
 */

/**
 * Domain-separation salt for the derived session secret. Distinct from
 * config-crypto's salt on purpose: the same JWT_SECRET feeds both, and they
 * must not produce the same derived key.
 *
 * Module-private deliberately. It is an implementation detail of the one
 * derivation below, and exporting it invites the second copy this file's header
 * warns about: a caller that imports the salt is a caller doing its own PBKDF2,
 * which is exactly how the derived value drifts by a byte and logs everyone out.
 */
const SESSION_SECRET_SALT = new TextEncoder().encode(
  "openinspection:session-cookie:v1",
);

/** PBKDF2 over JWT_SECRET — same shape config-crypto already uses. */
export async function deriveSessionSecret(jwtSecret: string): Promise<string> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(jwtSecret),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: SESSION_SECRET_SALT, iterations: 100_000, hash: "SHA-256" },
    material,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
