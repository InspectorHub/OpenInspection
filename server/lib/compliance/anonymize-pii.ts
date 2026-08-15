/**
 * Track I-a GDPR — shared satellite-PII anonymize SET builders.
 *
 * The SINGLE source of truth for the column→value mapping used when anonymizing
 * the satellite PII on a signed agreement envelope + its signer rows. Both the
 * erasure orchestrator (`erasure-orchestrator.ts`, on a DSAR) and the retention
 * sweep (`retention-sweep.ts`, the past-window data-minimization clock) consume
 * these so the two paths CANNOT drift: a row anonymized by an erase first and
 * then swept (or vice-versa) lands byte-identical values ('[erased]' sentinel
 * for NOT NULL columns, NULL for nullable ones — no double-mangling).
 *
 * The orchestrator KEEPS `signature_base64` (it is the retained evidence); the
 * sweep additionally NULLs it. That single differing column is layered on at the
 * sweep call-site, NOT here, so this module stays the pure satellite-PII set.
 */

/**
 * Sentinel written into NOT NULL PII columns on anonymize (`name`, `email`,
 * `client_email`). Nullable PII columns are set to NULL; NOT NULL columns cannot
 * be, so they get this non-PII marker instead (matches the standing
 * "sentinel-clear for NOT NULL columns" convention). Carries no personal data.
 */
const ERASED_SENTINEL = '[erased]';

/**
 * Satellite-PII SET for `agreement_signers` (D5 field set). `name` + `email` are
 * NOT NULL → sentinel; the rest are nullable → NULL. Does NOT include
 * `signature_base64` (the sweep layers that on; the orchestrator keeps it).
 */
export const ANONYMIZE_SIGNER_PII = {
    name: ERASED_SENTINEL,
    email: ERASED_SENTINEL,
    ipAddress: null,
    userAgent: null,
    onBehalfOf: null,
    onBehalfDisclaimer: null,
} as const;

/**
 * Satellite-PII SET for `agreement_requests` (denormalized client identity).
 * `client_email` is NOT NULL → sentinel; `client_name` is nullable → NULL. Does
 * NOT include `purged_at` (the sweep layers that on). The envelope carries no
 * signature of its own — that lives on `agreement_signers`.
 */
export const ANONYMIZE_REQUEST_PII = {
    clientName: null,
    clientEmail: ERASED_SENTINEL,
} as const;

/**
 * Identity SET for `inspection_requests` (#88). The ROW survives —
 * `inspections.request_id` carries a frozen legacy FK to it — so identity is
 * cleared in place: NOT NULL `client_name` -> sentinel, nullable
 * `client_email`/`client_phone` -> NULL. Clearing `client_email` also clears
 * the erasure locator, which is what makes a re-run idempotent (matches 0).
 */
export const ANONYMIZE_BOOKING_REQUEST_PII = {
    clientName: ERASED_SENTINEL,
    clientEmail: null,
    clientPhone: null,
} as const;

/**
 * Free-text SET for `audit_logs` (#276). `metadata` is a JSON blob a caller
 * composes, so it MAY embed a name, an address or a phrase about a person that
 * no pattern can recognise; `audit.ts` strips the machine-detectable
 * identifiers at write time, which is not the same as the column being clean.
 * Portal's counsel rejected retaining the equivalent column through an erasure
 * as an incomplete DSAR, so the whole value goes rather than parts of it — the
 * one action that needs no judgement and has no false-negative rate.
 *
 * The column is nullable, so the convention above applies: NULL, not the
 * sentinel. What survives is the structured event — `action`, `entity_type`,
 * `entity_id` — which is the whole reason an audit row is worth keeping.
 * `user_id` and `ip_address` are NOT here: they are the staff actor of a
 * security trail, not consumer-DSAR scope (see the manifest).
 *
 * Shared so the erasure orchestrator and the log-retention sweep cannot drift.
 */
export const ANONYMIZE_AUDIT_PII = {
    metadata: null,
} as const;
