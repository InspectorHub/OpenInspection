# Rotating JWT keys

OpenInspection's auth surface has one rotating secret:

1. **JWT signing keys** — ES256 keypairs in a multi-version keyring (`JWT_PRIVATE_KEY_V<N>` / `JWT_PUBLIC_KEY_V<N>` + `JWT_CURRENT_KID`).

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
#    (default ~24h; check your auth.ts setExpirationTime() value)

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

- **JWT_SECRET** (the legacy env var) is no longer used for JWT signing. It's still active as KDF input for `config-crypto`, `qbo-crypto`, and audit signing-key encryption. Rotating it requires a separate procedure (data re-encryption) not covered here.
- **CF account API token** (the OAuth credential `wrangler login` provisions) — rotate via `wrangler logout && wrangler login`. Operational hygiene, not in this runbook.
- **Stripe / Resend / Google API keys** — vendor-side rotation; follow each vendor's docs.

## Script reference

| Command | What it does |
|---|---|
| `npm run rotate:jwt` | New ES256 keypair → push V<N+1> → bump JWT_CURRENT_KID |
| `node scripts/rotate-jwt-keys.js --dry-run` | Preview without pushing |
| `node scripts/rotate-jwt-keys.js --prune-old-kid=v1` | Remove V1 |
