# Task 3 Report — PR #183 Tenant Isolation (getSignerLink + deleteOverride)

## Implementation Summary

### Fix 1: `getSignerLink` — tenantId param + WHERE predicate

**File**: `server/services/agreement/signer-state.ts`

Changed signature from `getSignerLink(requestId, signerId)` to `getSignerLink(tenantId, requestId, signerId)`.

Added `eq(agreementSigners.tenantId, tenantId)` to the WHERE clause. The lookup now requires all three columns to match: `id`, `requestId`, AND `tenantId`. A foreign tenant presenting a valid (requestId, signerId) pair from another tenant's envelope gets a NotFound error, not a plaintext token. No optional/fallback — fail closed.

**Interface updated**: `server/services/agreement/envelope-legacy.ts` `SignerStateDeps` interface updated to match new signature.

### Fix 2: `deleteOverride` — DELETE with tenantId predicate

**File**: `server/services/booking.service.ts`

Changed:
```ts
await db.delete(availabilityOverrides).where(eq(availabilityOverrides.id, id));
```
to:
```ts
await db.delete(availabilityOverrides).where(and(eq(availabilityOverrides.id, id), eq(availabilityOverrides.tenantId, tenantId)));
```

The SELECT before this DELETE already filtered by both `id` and `tenantId` (and throws NotFound when no match), so the existing defense was sound. The DELETE fix is defense-in-depth: if the SELECT guard were ever bypassed (e.g., by a future refactor), the DELETE still cannot cross tenant boundaries.

## TDD RED/GREEN Cycle Evidence

### RED state (before fixes)

```
 FAIL  tests/unit/agreement-signer-tenant-scope.spec.ts > AgreementService — getSignerLink cross-tenant isolation > foreign-tenant cannot retrieve signer token
AppError: Signer not found
 ❯ AgreementService.getSignerLink server/services/agreement/signer-state.ts:128:49
 ❯ tests/unit/agreement-signer-tenant-scope.spec.ts:35:26
```

The test called `svc.getSignerLink(TENANT_A, ...)` with 3 args but the method only accepted 2 args, so the own-tenant call at line 35 (`svc.getSignerLink(TENANT_A, r.requestId, signers[0].id)`) was interpreted as `getSignerLink(TENANT_A_as_requestId, r.requestId_as_signerId)` and failed to find the row.

The booking test passed immediately because the SELECT guard in `deleteOverride` already throws NotFound for cross-tenant IDs. The booking test is a behavioral assertion (cross-tenant cannot delete), not a compile check.

```
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 1 passed (2)
```

### GREEN state (after all fixes)

```
 Test Files  4 passed (4)
      Tests  29 passed (29)
```

All 4 affected test files (2 new + 2 updated existing) pass.

## Discriminator Evidence for getSignerLink

**Without tenant predicate** (predicate temporarily removed from WHERE):
```
 FAIL  tests/unit/agreement-signer-tenant-scope.spec.ts
AssertionError: promise resolved "'G1RPHil_MNwlMWYJHyZkMRIcEgoKy6cKZvmhy…'" instead of rejecting

Expected: Error { "message": "rejected promise" }
Received: "G1RPHil_MNwlMWYJHyZkMRIcEgoKy6cKZvmhyEn5GNQ"
```

TENANT_B got TENANT_A's signer token when the predicate was absent — the test correctly caught the bypass.

**With tenant predicate restored**:
```
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

The discriminator is effective.

## Caller Files Changed

| File | Change |
|---|---|
| `server/services/agreement/signer-state.ts` | Signature + WHERE predicate; internal callers in `getFirstOutstandingSignerLink` and `getSignerLinkByEmail` updated |
| `server/services/agreement/envelope-legacy.ts` | `SignerStateDeps` interface updated; internal call in `findOrCreate` updated (`env.tenantId, env.id, firstSigner.id`) |
| `server/api/admin/admin-esign.ts` | Two callers (getSignerLink + remindSigner routes) updated with `tenantId` as first arg |
| `server/api/admin/admin-agreements.ts` | One caller (email-each-signer loop) updated |
| `server/api/inspections/agreements.ts` | Two callers (sendAgreement and onsite-sign routes) updated |
| `server/services/booking.service.ts` | DELETE predicate extended with `eq(availabilityOverrides.tenantId, tenantId)` |

## Test Files Changed

| File | Change |
|---|---|
| `tests/unit/agreement-signers.spec.ts` | All `svc.getSignerLink(r.requestId, ...)` calls updated to 3-arg form (9 call sites) |
| `tests/unit/agreement-public-routes.spec.ts` | One call site in `createTwoSignerEnvelope` updated |
| `tests/unit/agreement-signer-tenant-scope.spec.ts` | New — discriminating cross-tenant isolation test |
| `tests/unit/booking-delete-override-scope.spec.ts` | New — cross-tenant deleteOverride behavioral test |

## Type Check

```
npm run type-check:api
```

Exits clean (no output, exit 0). All callers and the updated interface are consistent.

## Self-Review Notes

1. **`findOrCreate` reuse path**: uses `env.tenantId` (from the DB row) rather than the caller-supplied `tenantId` — equivalent because the SELECT above already filtered by `tenantId`, so `env.tenantId === tenantId`. This is correct and consistent.

2. **`getSignerLinkByEmail` and `getFirstOutstandingSignerLink`**: both take `tenantId` as their first parameter already, so threading through is straightforward and unambiguous.

3. **Booking discriminator limitation**: The `deleteOverride` discriminator cannot demonstrate the DELETE guard in isolation, because the SELECT guard always fires first for cross-tenant IDs. The fix is defense-in-depth: if the SELECT guard were ever removed or bypassed, the DELETE would still be safe.

4. **No migration required**: Both fixes are pure application-layer changes — no schema changes, no new columns.

## Concerns

None. The changes are minimal, targeted, and the discriminator confirms correctness for the critical `getSignerLink` path.

---

## Fix Wave — Remove `any` casts from `booking-delete-override-scope.spec.ts`

**Commit**: `test(#183): remove any-casts from booking override scope test`

### Changes made (test file only — no production code touched)

`tests/unit/booking-delete-override-scope.spec.ts`:

| Line | Before | After |
|---|---|---|
| 23 | `(mockDrizzle as any).mockReturnValue(db)` | `(mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db)` |
| 24 | `svc = new AvailabilityService({} as any)` | `svc = new AvailabilityService({} as D1Database)` |
| 30 | `] as any[]` (tenants seed) | removed cast |
| 36 | `} as any` (users seed) | removed cast |
| 49 | `} as any` (availabilityOverrides seed) | removed cast |

Patterns sourced from sibling specs:
- `mockDrizzle` pattern: `agreement-signer-tenant-scope.spec.ts` line 22 / `tenant-purge.service.spec.ts` line 74
- Service constructor pattern: `tenant-purge.service.spec.ts` line 77 (`{} as D1Database`)
- Seed inserts without cast: `tenant-purge.service.spec.ts` lines 58–69

### Verification

- `npx vitest run --config vitest.api.config.ts tests/unit/booking-delete-override-scope.spec.ts` → 1 file passed, 1 test passed
- `npm run type-check:api` → 0 errors (clean exit)
- `grep -c 'any' tests/unit/booking-delete-override-scope.spec.ts` → 0
- Only `tests/unit/booking-delete-override-scope.spec.ts` and `.superpowers/sdd/task-3-report.md` changed
