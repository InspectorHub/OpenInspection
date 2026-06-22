# Task 2 Report: Tenant-scope `portal-access.service.ts`

## Status
DONE

## Implementation

### Service changes (`server/services/portal-access.service.ts`)
1. **`issueToken` existing-token lookup (~:56-62)**: Added `eq(inspectionAccessTokens.tenantId, input.tenantId)` as the first predicate in the `and(...)` clause. `tenantId` was already in `input` — no signature change needed.
2. **`revokeForRecipient` (~:164-175)**: Added leading `tenantId: string` param; added `eq(inspectionAccessTokens.tenantId, tenantId)` predicate unconditionally.
3. **`setExpiryForInspection` (~:176-186)**: Added leading `tenantId: string` param; changed from single `eq(...)` to `and(eq(tenantId,...), eq(inspectionId,...))`.

All three predicates are UNCONDITIONAL (no `if (tenantId)` / no ternary) per fail-closed contract.

### Caller files updated
- `tests/unit/portal-access.spec.ts:121`: Updated `svc.revokeForRecipient(INSPECTION, 'c@x.com')` to `svc.revokeForRecipient(TENANT, INSPECTION, 'c@x.com')`.

No API route callers of `revokeForRecipient` or `setExpiryForInspection` exist in `server/api/` — confirmed by grep. `issueToken` callers all already pass `tenantId` (no signature change needed there).

## TDD RED/GREEN

### RED
```
npx vitest run --config vitest.api.config.ts tests/unit/portal-access-tenant-scope.spec.ts
→ 1 failed | 2 passed
FAIL: issueToken test — "expected [ { …(11) } ] to have a length of 2 but got 1"
(the unscoped lookup finds T1's row for T2's call; only one row exists, no separate T2 row)
```

Note: The `revokeForRecipient`/`setExpiryForInspection` tests pass vacuously in RED because the test calls them with the new 3-arg signature which didn't exist yet (TypeScript would catch this at type-check).

### GREEN (after fix)
```
npx vitest run --config vitest.api.config.ts tests/unit/portal-access-tenant-scope.spec.ts
→ 3 passed
npx vitest run --config vitest.api.config.ts tests/unit/portal-access.spec.ts
→ 12 passed
npm run type-check:api → 0 errors
```

## Test Design Note
The `issueToken` test seeds a T1 row for `(i-1, jane@x.com)` and has T2 issue for `(i-2, jane@x.com)`. Using the same `inspectionId` as T1 would hit the `uniqueIndex('idx_iat_recipient').on(t.inspectionId, t.recipientEmail)` constraint (which does not include `tenant_id`). Using different inspection IDs correctly tests that T1's row is neither found nor modified by T2's lookup, and that T2 mints its own separate row. In production, inspection IDs are UUIDs so cross-tenant collision is cryptographically impossible.

## Concerns
None. The `uniqueIndex` on `(inspection_id, recipient_email)` without `tenant_id` means two tenants cannot have an access token row for the exact same `(inspectionId, recipientEmail)` pair — this is acceptable because inspection IDs are UUIDs.

---

## Review Fix (test(#183)): issueToken tenant-scope test now locks in the predicate

### Problem
The original `issueToken` test used `inspectionId='i-2'` for T2 (different from T1's `'i-1'`), so the lookup missed T1's row on `inspectionId` alone. Removing the `eq(tenantId)` predicate would not cause a regression — the test passed regardless.

### Fix
Rewrote the `issueToken` test to use the SAME `inspectionId='i-1'` that T1 used, seeding T1's row with a properly sealed `tokenEnc` (via `sealToken`). This makes the test a true discriminator:

- **WITH** `eq(tenantId)` predicate: T2 lookup finds nothing → tries INSERT `(T2, 'i-1', 'jane@x.com')` → UNIQUE constraint on `(inspection_id, recipient_email)` → **rejects/throws** ✓
- **WITHOUT** `eq(tenantId)` predicate: T2 lookup finds T1's row (revokedAt=null) → `reconstruct()` opens `tokenEnc` → **resolves with T1's plaintext token** (cross-tenant data leak) ✗

Key design choices:
- `tokenEnc` must be set (via `sealToken`) so that `reconstruct()` succeeds on the no-predicate path. Without it, both paths throw — for different reasons — and the test cannot discriminate.
- Added assertion that only T1's row exists after the (rejected) T2 attempt, confirming no partial T2 row was committed.

### Discriminator Evidence

**Without predicate** (temporarily removed `eq(inspectionAccessTokens.tenantId, input.tenantId)`):
```
FAIL  tests/unit/portal-access-tenant-scope.spec.ts (1 failed)
AssertionError: promise resolved "'xV1mDBn5XSIE9iUXYs6Ssp_ZxlwdxDWsN0ViDnQjfhA'"
instead of rejecting
```
The call returned T1's plaintext token — confirming the cross-tenant leak the predicate prevents.

**With predicate restored**:
```
Test Files  1 passed (1)
     Tests  3 passed (3)
```

### Type-check
`npm run type-check:api` → 0 errors.

### Service file unchanged
`git diff 00490e9f -- server/services/portal-access.service.ts` → empty (no diff).
