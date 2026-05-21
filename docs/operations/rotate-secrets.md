# Rotating JWT keys and the M2M shared secret

OpenInspection's auth surface has two rotating secrets:

1. **JWT signing keys** — ES256 keypairs in a multi-version keyring (`JWT_PRIVATE_KEY_V<N>` / `JWT_PUBLIC_KEY_V<N>` + `JWT_CURRENT_KID`).
2. **M2M shared secret** — bearer/HMAC secret between portal and core (`PORTAL_M2M_SECRET_V<N>` + `PORTAL_M2M_CURRENT_KID`).

Both support zero-downtime overlap rotation. Operators run two scripts; users do not notice.

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
cd apps/core

# 1. Mint a new keypair, push to all 5 worker targets, bump JWT_CURRENT_KID
npm run rotate:jwt

# 2. Redeploy both workers so they pick up the new env var bindings
npm run deploy           # openinspection-standalone
npm run deploy:saas      # inspectorhub-core-shared
cd ../portal && npm run deploy

# 3. Wait at least the maximum JWT TTL since rotation
#    (default ~24h; check your auth.ts setExpirationTime() value)

# 4. Prune the previous kid
cd ../core
node scripts/rotate-jwt-keys.js --prune-old-kid=v<old>
```

What happens during the overlap window: workers hold BOTH `v<old>` and `v<new>` keypairs. New tokens are signed with `v<new>` (the current kid). Existing tokens signed with `v<old>` still verify because `v<old>` is still in the keyring. Once max-TTL elapses, no in-flight tokens reference `v<old>` anymore, so it's safe to prune.

### Dry-run preview

```bash
node scripts/rotate-jwt-keys.js --dry-run
```

Prints the new keypair (truncated) and the wrangler commands that would be issued. No actual changes.

## M2M secret rotation

### Procedure

```bash
cd apps/core

# 1. Mint new secret, push to all 5 targets, bump PORTAL_M2M_CURRENT_KID
npm run rotate:m2m

# 2. Redeploy in this specific order:
cd ../portal && npm run deploy     # portal first — it switches outbound to new secret
cd ../core && npm run deploy && npm run deploy:saas  # core picks up new env vars

# 3. Wait a few minutes for in-flight M2M calls to drain
#    (portal→core requests have no inherent TTL — drain is just round-trip time)

# 4. Prune the previous kid
node scripts/rotate-m2m-secret.js --prune-old-kid=v<old>
```

Why portal first: portal originates outbound M2M calls. Once portal deploys, it sends only the new secret. Core (still holding both old and new) accepts it. If you deploy core first, portal still sends the old secret and core has to accept it — fine, but you waste rotation effort.

### Dry-run preview

```bash
node scripts/rotate-m2m-secret.js --dry-run
```

## First-time setup

On a fresh deploy with no keys provisioned, run each rotation script once. The "no current kid → start at v1" branch handles it:

```bash
npm run rotate:jwt    # mints JWT_PRIVATE_KEY_V1 + JWT_PUBLIC_KEY_V1 + sets JWT_CURRENT_KID=v1
npm run rotate:m2m    # mints PORTAL_M2M_SECRET_V1 + sets PORTAL_M2M_CURRENT_KID=v1
```

Then deploy both workers. They start with v1 immediately.

## Emergency rotation (active compromise)

Skip the overlap window — accept the user impact:

```bash
# 1. Rotate
npm run rotate:jwt
npm run rotate:m2m

# 2. Deploy immediately
cd ../portal && npm run deploy
cd ../core && npm run deploy && npm run deploy:saas

# 3. Prune the old kid right away (no waiting)
node scripts/rotate-jwt-keys.js --prune-old-kid=v<old>
node scripts/rotate-m2m-secret.js --prune-old-kid=v<old>
```

Users with existing JWTs get 401 on their next request and re-login. M2M calls in flight get 401 once and retry with the new secret on the portal side. Containment beats UX.

## Verifying a rotation worked

After deploying with new secrets:

```bash
# Per worker target, confirm new env vars are populated
npx wrangler secret list                              # standalone
npx wrangler secret list --env saas                   # saas
npx wrangler secret list -c wrangler.saas.toml        # inspectorhub-core-shared
cd ../portal && npx wrangler secret list              # portal

# Each should now show JWT_PRIVATE_KEY_V<NEW>, JWT_PUBLIC_KEY_V<NEW>,
# JWT_CURRENT_KID = v<NEW>, PORTAL_M2M_SECRET_V<NEW>, PORTAL_M2M_CURRENT_KID = v<NEW>
```

Functional check:

1. Hit `/login` on a deployed worker, log in. Cookie set. Visit a protected route → 200.
2. Trigger a portal→core M2M call (e.g. provision a test tenant via portal `/api/sysadmin/tenants/:id/approve` → portal's OnboardingWorkflow calls core). Verify the call returns 2xx.

## Failure recovery

### "wrangler secret put failed mid-rotation on one of 5 targets"

Re-run the rotation script. It's idempotent — same target gets pushed the same value. If the failure was network/timeout, retry is safe.

### "JWT_CURRENT_KID set but private key missing"

`buildKeyring()` throws on startup. Worker returns 5xx on every request. Push the missing var:

```bash
npx wrangler secret put JWT_PRIVATE_KEY_V<N>  # from .dev.vars or a fresh keypair if .dev.vars was lost
```

### "Pruned a kid too early; still-valid tokens in flight"

Re-mint and re-push the same kid:

```bash
# Get the PEMs from your local .dev.vars (if still there) or generate fresh
# Push them under the same V<N> name to restore the keyring
```

Users hit by the gap re-login; the gap is bounded by how long ago you pruned.

### "Wrangler login expired during rotation"

Run `wrangler logout && wrangler login` to refresh OAuth token. Re-run the rotation script — it picks up where it left off (idempotent).

## What's NOT in scope

- **JWT_SECRET** (the legacy env var) is no longer used for JWT signing. It's still active as KDF input for `config-crypto`, `qbo-crypto`, audit signing-key encryption, and one M2M Bearer fallback. Rotating it requires a separate procedure (data re-encryption) not covered here.
- **CF account API token** (the OAuth credential `wrangler login` provisions) — rotate via `wrangler logout && wrangler login`. Operational hygiene, not in this runbook.
- **Stripe / Resend / Google API keys** — vendor-side rotation; follow each vendor's docs.

## Script reference

| Command | What it does |
|---|---|
| `npm run rotate:jwt` | New ES256 keypair → push V<N+1> → bump JWT_CURRENT_KID |
| `npm run rotate:m2m` | New 48-byte random hex → push V<N+1> → bump PORTAL_M2M_CURRENT_KID |
| `node scripts/rotate-jwt-keys.js --dry-run` | Preview without pushing |
| `node scripts/rotate-jwt-keys.js --prune-old-kid=v1` | Remove V1 from all targets |
| `node scripts/rotate-m2m-secret.js --dry-run` | Preview |
| `node scripts/rotate-m2m-secret.js --prune-old-kid=v1` | Remove V1 from all targets |

Both scripts target 4 workers: `openinspection-standalone`, `openinspection-saas`, `inspectorhub-core-shared`, `inspectorhub-portal`.
