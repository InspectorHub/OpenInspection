# Rotating the JWT keyring

Two different keys in this system rotate, and confusing them is easy because
both are "the signing key". Only the first is an operator task, and only the
first is documented here:

1. **JWT signing keys** — ES256 keypairs in a multi-version keyring
   (`JWT_PRIVATE_KEY_V<N>` / `JWT_PUBLIC_KEY_V<N>` + `JWT_CURRENT_KID`). These
   sign **login sessions**. Operator-level, stored as Worker secrets.
2. **Tenant e-signature keys** — one Ed25519 keypair per tenant in the D1
   `signing_keys` table. These seal **evidence**: agreement audit chains and
   published report versions. Tenant-level, rotated by the company's owner from
   the app.

Both keep history, and for the same reason: a rotation must not invalidate what
the old key already covered. They differ in what happens afterwards. A retired
JWT kid may be pruned once its tokens have expired, because a session is
temporary. **A retired e-sign key is never deleted** — the signatures it sealed
are evidence, and the public half is the only thing that can ever prove them.

The JWT keyring supports zero-downtime overlap rotation. You run one script and redeploy the
single Worker; users do not notice.

## When to rotate

Rotation is **event-driven**, not scheduled. Trigger on any of:

- Suspected key compromise (wrangler API token leaked, suspicious deploy, logs leaked)
- Team member departure if they ever had `wrangler login` to this account
- Annual review / compliance milestone
- Long stretch since last rotation (1–2 years)

There is no business reason to rotate on a fixed cron — these aren't access tokens. Skip "weekly rotation" cargo-culting.

## JWT keypair rotation

### Procedure

```bash
cd apps/openinspection

# 1. Mint a new keypair, push the secrets to the Worker, bump JWT_CURRENT_KID
npm run rotate:jwt

# 2. Redeploy so the Worker picks up the new env var bindings
npm run deploy

# 3. Wait at least the maximum JWT TTL since rotation
#    (24h — the `exp` claim in server/api/auth.ts is `now + 60 * 60 * 24`;
#     this project mints JWTs by hand, so there is no setExpirationTime() to read)

# 4. Prune the previous kid
node scripts/rotate-jwt-keys.js --prune-old-kid=v<old>
```

What happens during the overlap window: the Worker holds BOTH `v<old>` and `v<new>` keypairs. New tokens are signed with `v<new>` (the current kid). Existing tokens signed with `v<old>` still verify because `v<old>` is still in the keyring. Once max-TTL elapses, no in-flight tokens reference `v<old>` anymore, so it's safe to prune.

### Dry-run preview

```bash
node scripts/rotate-jwt-keys.js --dry-run
```

Prints the new keypair (truncated) and the wrangler commands that would be issued. No actual changes.

## First-time setup

On a fresh deploy with no keys provisioned, run the rotation script once. The "no current kid → start at v1" branch handles it:

```bash
npm run rotate:jwt    # mints JWT_PRIVATE_KEY_V1 + JWT_PUBLIC_KEY_V1 + sets JWT_CURRENT_KID=v1
```

Then deploy the Worker. It starts with v1 immediately.

> Note: `npm run deploy` already runs `jwt:ensure`, so a brand-new deploy provisions V1
> automatically. Run `rotate:jwt` manually only when you want to roll to a new version.

## Emergency rotation (active compromise)

Skip the overlap window — accept the user impact:

```bash
# 1. Rotate
npm run rotate:jwt

# 2. Deploy immediately
npm run deploy

# 3. Prune the old kid right away (no waiting)
node scripts/rotate-jwt-keys.js --prune-old-kid=v<old>
```

Users with existing JWTs get 401 on their next request and re-login. Containment beats UX.

## Verifying a rotation worked

After deploying with new secrets:

```bash
# Confirm the new env vars are populated on the Worker
npx wrangler secret list

# It should now show JWT_PRIVATE_KEY_V<NEW>, JWT_PUBLIC_KEY_V<NEW>,
# JWT_CURRENT_KID = v<NEW>
```

Functional check: hit `/login` on the deployed Worker, log in (cookie set), then visit a
protected route → 200. Old tokens signed with the pruned kid get 401 and re-login.

## Failure recovery

### "wrangler secret put failed mid-rotation"

Re-run the rotation script. It's idempotent — the target gets pushed the same value. If the failure was network/timeout, retry is safe.

### "JWT_CURRENT_KID set but private key missing"

`buildKeyring()` throws on startup. The Worker returns 5xx on every request. Push the missing var:

```bash
npx wrangler secret put JWT_PRIVATE_KEY_V<N>  # from .dev.vars or a fresh keypair if .dev.vars was lost
```

### "Pruned a kid too early; still-valid tokens in flight"

Re-mint and re-push the same kid under the same `V<N>` name to restore the keyring. Users hit by the gap re-login; the gap is bounded by how long ago you pruned.

### "Wrangler login expired during rotation"

Run `wrangler logout && wrangler login` to refresh the OAuth token. Re-run the rotation script — it picks up where it left off (idempotent).

## What's NOT in scope

- **Tenant e-signature keys.** A different keyring with different rules — old
  public keys are never deleted, because deleting one invalidates every
  signature it verified. It is an owner-facing operation that exists in both
  deployment modes, so it is documented with the product:
  <https://inspectorhub.io/docs/rotate-signing-key>.
- **JWT_SECRET** (the legacy env var) is no longer used for JWT signing. It is still active as KDF input for `config-crypto`, `qbo-crypto`, and the encryption of the tenant signing keys' private halves (when `KEY_ENCRYPTION_SECRET` is not set). Rotating it is a data re-encryption, not a key swap:
  1. Set the new value as `JWT_SECRET` and the old value as `JWT_SECRET_PREVIOUS`, and deploy. Anything wrapped under the old value still opens, and a signing key is re-wrapped the first time it is used.
  2. Run the re-encrypt endpoint (`POST /api/platform/secrets/reencrypt`, hosted deployments) **repeatedly**. Each call is bounded so it fits a Free-plan invocation. It first re-wraps up to 25 active tenant signing keys and reports `signingKeys: { rewrapped, alreadyCurrent, remaining, done }`; `remaining` is the number of active keys still not under the current secret. It then re-encrypts the tenants' stored secrets (`failed` lists any tenant it did not reach in this call, and `secretsComplete: false` with `secretsError` means that part did not finish); every part is idempotent and a converged row costs nothing, so just run it again. Stop when `signingKeys.done` is `true`, `failed` is empty and `secretsComplete` is `true`.
  3. Remove `JWT_SECRET_PREVIOUS` **only when `signingKeys.remaining` is zero**. Removing it earlier strands every tenant that has not signed since the rotation: their signing is refused until the old value is supplied again.
  If `KEY_ENCRYPTION_SECRET` is set, a signing key still wrapped under `JWT_SECRET` is re-wrapped under it the first time the key is used, with no further step. The value is therefore not a trial setting: if it is mistyped, the keys that were used meanwhile are wrapped under the typo, and neither the corrected value nor `JWT_SECRET` opens them. Signing for those companies is refused (and an alert is raised) until the mistyped value is supplied as `JWT_SECRET_PREVIOUS`. Nothing is lost and no public key or signature changes. Check the value before the first signing after you set it.
  4. Only ONE previous secret is supported. A second rotation (A to B to C) must wait until step 2 reported zero for B; otherwise keys still under A can no longer be opened.
  A standalone deployment has no such endpoint; its (single) tenant's key is re-wrapped the first time the tenant signs after the change, so keep `JWT_SECRET_PREVIOUS` until the company has signed once. The session keyring above is a different system and is not affected.
- **CF account API token** (the OAuth credential `wrangler login` provisions) — rotate via `wrangler logout && wrangler login`. Operational hygiene, not in this runbook.
- **Stripe / Resend / Google API keys** — vendor-side rotation; follow each vendor's docs.

## Script reference

| Command | What it does |
|---|---|
| `npm run rotate:jwt` | New ES256 keypair → push V<N+1> → bump JWT_CURRENT_KID |
| `node scripts/rotate-jwt-keys.js --dry-run` | Preview without pushing |
| `node scripts/rotate-jwt-keys.js --prune-old-kid=v1` | Remove V1 |

There is no script for the tenant e-signature key: it is per-tenant application
state, not an operator secret, and rotating it belongs to the company that owns
the evidence.
