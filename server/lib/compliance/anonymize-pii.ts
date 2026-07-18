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
 * NOT include `signature_base64` / `purged_at` (the sweep layers those on).
 */
export const ANONYMIZE_REQUEST_PII = {
    clientName: null,
    clientEmail: ERASED_SENTINEL,
} as const;
