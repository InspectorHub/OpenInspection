# Task 3 Report — Delete vestigial envelope-token methods

## Step 1: Grep-gate results (verbatim)

Command:
```
grep -rn "createSigningRequest|\.signRequest(|getRequestByToken|getAgreementByToken|\.markViewed(|\.markSigned(|\.markDeclined(" server/ app/ | grep -v "BySigner"
```

Results in `server/` + `app/` (production code):

```
server/api/bookings/agreement.ts:19:const getAgreementByTokenRoute = createRoute(withMcpMetadata({
server/api/bookings/agreement.ts:190:    .openapi(getAgreementByTokenRoute, async (c) => {
server/index.ts:689:            // `createSigningRequest` envelopes whose plaintext token IS
server/services/agreement/envelope-legacy.ts:32:        async createSigningRequest(tenantId: string, data: {
server/services/agreement/envelope-legacy.ts:65:        async getRequestByToken(token: string) {
server/services/agreement/envelope-legacy.ts:106:        async getAgreementByToken(token: string) {
server/services/agreement/envelope-legacy.ts:107:            const request = await this.getRequestByToken(token);
server/services/agreement/envelope-legacy.ts:119:            const request = await this.getRequestByToken(token);
server/services/agreement/envelope-legacy.ts:170:                // Legacy reuse path: an envelope created via `createSigningRequest`
server/services/agreement/signer-state.ts:84:         * none (created via the pre-envelope-v2 `createSigningRequest` path). The
server/services/inspection/inspection-publish.service.ts:153:        // (still resolves for legacy `createSigningRequest` envelopes whose
```

Results in `tests/`:

```
tests/unit/agreement.service.spec.ts:110:        const v = await svc.markViewed(envToken);
tests/unit/agreement.service.spec.ts:112:        await svc.markSigned(envToken, 'siglegacy', Date.now());
tests/unit/inspection-sign-unification.spec.ts:167:    // 6b — legacy envelope (createSigningRequest, no signer rows) → findOrCreate
tests/unit/inspection-sign-unification.spec.ts:171:        // Create a legacy envelope via createSigningRequest — it has a distributed
tests/unit/inspection-sign-unification.spec.ts:174:        const legacy = await legacySvc.createSigningRequest(TENANT_ID, {
```

### Classification

| Match | Classification | Action |
|---|---|---|
| `server/api/bookings/agreement.ts:19` — `const getAgreementByTokenRoute` | Variable name (NOT a service method call); handler body calls `svc.getSignerByPresentedToken` | No blocker |
| `server/api/bookings/agreement.ts:190` — `.openapi(getAgreementByTokenRoute, …)` | Same route variable reference | No blocker |
| `server/index.ts:689` — comment | Comment only, no method call | No blocker |
| `signer-state.ts:84` — comment | Comment only | No blocker |
| `inspection-publish.service.ts:153` — comment | Comment only | No blocker |
| `envelope-legacy.ts` lines — self-references | Methods being deleted (internal cross-references) | Deleted together |
| `agreement.service.spec.ts:110,112` | Test caller of envelope `markViewed`/`markSigned` | Updated |
| `inspection-sign-unification.spec.ts:174` | Test caller of `createSigningRequest` | Updated |

**Conclusion:** Zero non-test production callers. All matches in `server/` are either variable names, comments, or self-references within the file being edited. Safe to delete all seven methods.

Ran a second narrower grep to confirm no `svc.*` production method calls:
```
grep -rn "svc\.getAgreementByToken|svc\.signRequest|svc\.getRequestByToken|svc\.createSigningRequest|svc\.markViewed|svc\.markSigned|svc\.markDeclined" server/ app/
```
→ zero output.

## Step 2: Test updates

### `tests/unit/agreement.service.spec.ts` (~lines 101–116)
Replaced the "legacy envelope-token markViewed/markSigned/markDeclined still work" test with "per-signer markViewedBySigner/markSignedBySigner drive envelope state". The new test uses `findOrCreate` to create the envelope + signer row, then drives state via `markViewedBySigner` / `markSignedBySigner`. The semantics tested (view transitions, sign transitions, status column + signatureBase64) are identical.

### `tests/unit/inspection-sign-unification.spec.ts` (test 6b, ~lines 167–211)
Replaced the `legacySvc.createSigningRequest(…)` call with a direct `db.insert(schema.agreementRequests, …)` — same shape as what `createSigningRequest` would have inserted (plaintext token distributed, no `agreement_signers` rows). The test still covers the real scenario: `findOrCreate` reuse path synthesizes a signer from a signer-less legacy envelope. Updated `legacy.id` references to `legacyReqId`.

## Step 3: Deletions in `envelope-legacy.ts`

Removed:
- `createSigningRequest` — no production callers; rerouted to `findOrCreate` in Tasks 1 & 2
- `getRequestByToken` — only called by `getAgreementByToken` and `signRequest` (both now gone)
- `getAgreementByToken` — only external "caller" in production code is a route variable name, not a service method call; the actual handler uses `getSignerByPresentedToken`
- `signRequest` — no production callers
- `markViewed` — no production callers; production uses `markViewedBySigner`
- `markSigned` — no production callers; production uses `markSignedBySigner`
- `markDeclined` — no production callers; production uses `markDeclinedBySigner`

Kept (as specified):
- `findPendingByInspectionId` — used by the public `/sign/:id` redirect route
- `listRequests` — used by admin agreement list endpoints
- `expireOlderThan` — used by the cron handler
- `getSnapshotForRequest` — used by agreement public routes and checkout route
- `findOrCreate` — the primary envelope creation/reuse entry point

Updated JSDoc comment on the mixin class to drop references to the removed methods.

## Step 4: Type-check + test results

`npm run type-check:api`: **PASS** (exit 0, no errors)

`npm run test:unit` (full suite):
- **1939 passed, 8 skipped, 2 failed**
- The 2 failures are **pre-existing** in `tests/unit/inspection-agreement-request.spec.ts` (500 vs 200 for `POST /api/inspections/:id/agreement-requests`); they were present before this task and are unrelated to the deletions
- All agreement-related test files green: `agreement.service.spec.ts`, `agreement-signers.spec.ts`, `agreement-public-routes.spec.ts`, `agreement-send-endpoints.spec.ts`, `inspection-sign-unification.spec.ts`, `inspector-pre-sign.spec.ts`

## Self-review

- No production callers were deleted; the grep-gate was conclusive.
- `getAgreementByToken` route name in `agreement.ts` caused a superficial grep hit but the handler body clearly calls `svc.getSignerByPresentedToken` — confirmed by reading lines 190–233.
- All imports in `envelope-legacy.ts` remain referenced by the retained methods; no unused-import TS errors.
- Comments in `signer-state.ts` and `inspection-publish.service.ts` referencing `createSigningRequest` are historical context in docstrings — left in place (they describe the legacy path that `synthesizeDefaultSigner` still handles).
- Test count unchanged vs baseline (1939/8/2).

## Concerns

None. The deletion surface was clean.
