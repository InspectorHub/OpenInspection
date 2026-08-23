/**
 * The account-export classification for the `users` row.
 *
 * `exportAccount` (server/services/account.service.ts) is the GDPR/CCPA
 * self-serve data export behind `POST /api/identities/account/export`. It used
 * to open with a star select on `users` and hand the whole row back, so the
 * download carried the caller's password hash, their TOTP seed and their TOTP
 * recovery-code hashes. It is the caller's own data, so it was never a
 * cross-user leak — but a TOTP seed is a LIVE second factor: anyone who ends up
 * holding the blob can mint valid codes indefinitely, and export blobs travel
 * (Downloads folders, cloud sync, support tickets, forwarded email).
 *
 * ── WHY A CLASSIFICATION AND NOT A DENYLIST OR AN ALLOWLIST ─────────────────
 *
 * Deleting three fields at the call site would fix today and reopen tomorrow.
 * The two obvious shapes each fail in one direction, and the directions are not
 * symmetrical in cost but they are both real:
 *
 *   DENYLIST (drop these three, ship the rest) — complete by default, which is
 *   exactly what a data-portability export wants: a personal-data column added
 *   next month is exported without anybody remembering to. But a SECRET column
 *   added next month is exported too, silently, and the failure is not
 *   recoverable — a credential that has left cannot be un-sent.
 *
 *   ALLOWLIST (ship only these, drop the rest) — safe against a new secret
 *   column, and wrong in the other direction: a new personal-data column
 *   silently vanishes from the export, which under-discloses on a
 *   subject-access request. That failure is quiet, and the export looks healthy
 *   the whole time it is incomplete.
 *
 * So neither default is taken. Every column of `users` is CLASSIFIED here as
 * `export` or `withhold`, each with a reason, and a new column that is neither
 * is a hard test failure — the same resolution `erasure-manifest.ts` reached
 * for the same shape (every PII-heuristic column is a rule or an explicit
 * out-of-scope entry with a reason, and a gate refuses anything else).
 * `tests/unit/privacy/account-export-classification.spec.ts` is the enforcement
 * and states why it is a test rather than a `scripts/check-*.mjs` gate.
 *
 * The runtime default for an unclassified column is WITHHOLD, and that choice
 * only ever applies in the window between a column being added and the test
 * being run. It is the recoverable failure of the two, and it is not silent:
 * an unclassified column is reported in the export bundle's own `identityWithheld`
 * list, so a subject reading an under-disclosing export can see that something
 * was held back and ask why. A vanished column with no trace is the thing the
 * allowlist critique above is about, and this is what stops it.
 *
 * ⚠️ A reason here is prose and prose is not evidence — the erasure manifest
 * carries the same warning after two of its justifications were checked against
 * the code and found false. Before relying on one of these lines, go read what
 * writes the column.
 */

/**
 * What the export does with one column of `users`.
 *
 * Deliberately NOT exported: nothing outside this module needs to name it, and
 * the dead-code gate flags an exported type with no external reader — a public
 * symbol nobody imports is surface to keep in sync for no reason. Reach it as
 * `AccountExportFieldRule['disposition']` if that ever changes.
 */
type AccountExportDisposition = 'export' | 'withhold';

/**
 * One column of `users`, classified.
 *
 * `field` is the DRIZZLE PROPERTY name, because that is the key the selected
 * row (and therefore the exported JSON) actually carries. `column` is the
 * snake_case DB name, because that is the vocabulary a DSAR audit and the
 * erasure register speak. Both are recorded and the spec asserts they match the
 * live table, so a column rename cannot leave this file describing a shape that
 * no longer exists.
 */
export interface AccountExportFieldRule {
    field: string;
    column: string;
    disposition: AccountExportDisposition;
    reason: string;
}

/**
 * Every column of `users`, classified. Ordered as the schema declares them so a
 * reader can walk the two side by side.
 *
 * A `withhold` reason must say why the field cannot be handed to the subject
 * who owns it. "It is sensitive" is not that reason — the whole export is
 * sensitive. The three below are withheld because each is a CREDENTIAL: a value
 * whose only purpose is to authenticate, so a copy of it is an authentication,
 * and the copy outlives the download.
 */
export const ACCOUNT_EXPORT_CLASSIFICATION: AccountExportFieldRule[] = [
    { field: 'id', column: 'id', disposition: 'export', reason: 'the subject\'s own account identifier; the join key every other exported row hangs off' },
    { field: 'tenantId', column: 'tenant_id', disposition: 'export', reason: 'which workspace this account belongs to — NULL for a global agent account, and that NULL is itself a fact about the account' },
    { field: 'email', column: 'email', disposition: 'export', reason: 'the subject\'s own contact address and the identifier they log in with' },
    // ── The three credentials. ───────────────────────────────────────────────
    // Withheld because possession IS the authentication, not because the value
    // is embarrassing. Note that all three are already declared in
    // ERASURE_OUT_OF_SCOPE for the mirror-image reason (they are destroyed by
    // account deletion, never by a consumer erasure request) — the erasure
    // register says nothing about export, which is why this file exists.
    {
        field: 'passwordHash', column: 'password_hash', disposition: 'withhold',
        reason: 'authentication credential — a PBKDF2 hash is offline-crackable at leisure, and the export blob is the one copy of it that travels outside the database',
    },
    { field: 'name', column: 'name', disposition: 'export', reason: 'the subject\'s own display name' },
    { field: 'phone', column: 'phone', disposition: 'export', reason: 'the subject\'s own contact number' },
    { field: 'photoUrl', column: 'photo_url', disposition: 'export', reason: 'the subject\'s own profile photo, which they uploaded and which is already published on the booking page' },
    {
        field: 'defaultSignatureBase64', column: 'default_signature_base64', disposition: 'export',
        reason: 'the saved signature drawing the subject made themselves. Withholding it was considered and rejected: the same image is rendered onto every report this inspector publishes, so every report recipient already holds it — it is not a secret, and dropping it would under-disclose data the subject literally provided while buying no protection. It is NOT a cryptographic credential; signed rows are verified against the tenant e-sign keyring by key_fingerprint, never against this drawing',
    },
    { field: 'signatureEnabled', column: 'is_signature_enabled', disposition: 'export', reason: 'a preference the subject set about how their own signature block appears' },
    { field: 'slug', column: 'slug', disposition: 'export', reason: 'the public URL slug derived from the subject\'s name; already public wherever it resolves' },
    { field: 'role', column: 'role', disposition: 'export', reason: 'what this account is permitted to do — a fact about the subject\'s standing in the workspace' },
    { field: 'onboardingState', column: 'onboarding_state', disposition: 'export', reason: 'one-time UI flags recording what the subject has dismissed or skipped; behavioural data about them' },
    { field: 'createdAt', column: 'created_at', disposition: 'export', reason: 'when the account was created' },
    {
        field: 'totpSecret', column: 'totp_secret', disposition: 'withhold',
        reason: 'authentication credential and the sharpest of the three — a TOTP seed is a LIVE second factor with no expiry, so a copy in a downloaded file generates valid codes for as long as 2FA stays enabled. Exporting it would defeat the factor it exists to be',
    },
    { field: 'totpEnabled', column: 'is_totp_enabled', disposition: 'export', reason: 'WHETHER the subject has 2FA on is a fact about their account and discloses nothing that helps bypass it; only the seed is withheld' },
    {
        field: 'totpRecoveryCodes', column: 'totp_recovery_codes', disposition: 'withhold',
        reason: 'authentication credential — hashed single-use codes, each of which bypasses the second factor. The plaintext codes were shown once at enrollment and are unrecoverable by design, so exporting the hashes discloses nothing usable to the subject while handing an offline target to anyone else holding the blob',
    },
    { field: 'totpVerifiedAt', column: 'totp_verified_at', disposition: 'export', reason: 'when the subject last completed a second-factor challenge — an event in their own account history' },
    { field: 'lastActiveAt', column: 'last_active_at', disposition: 'export', reason: 'behavioural data about the subject; the fact that it is also used for seat accounting does not make it somebody else\'s data' },
    { field: 'deletedAt', column: 'deleted_at', disposition: 'export', reason: 'whether and when the account was soft-deleted; the subject is entitled to see that the deletion they asked for was recorded' },
    { field: 'termsAccepted', column: 'terms_accepted', disposition: 'export', reason: 'the acceptance evidence the subject generated — version, content hash, time, and the IP and country captured with it. All of it is about them' },
    { field: 'permissionOverrides', column: 'permission_overrides', disposition: 'export', reason: 'per-account capability diffs off the role template — what this subject may do' },
    { field: 'timezone', column: 'timezone', disposition: 'export', reason: 'a display preference the subject set' },
    { field: 'locale', column: 'locale', disposition: 'export', reason: 'the language the subject asked to be addressed in — a stated preference of the data subject' },
    { field: 'dateFormat', column: 'date_format', disposition: 'export', reason: 'a display preference the subject set' },
    { field: 'timeFormat', column: 'time_format', disposition: 'export', reason: 'a display preference the subject set' },
    // The routing-origin family. ERASURE_OUT_OF_SCOPE excuses these from
    // CONSUMER erasure ("staff routing origin, may be a home address — staff
    // offboarding lifecycle, not consumer-DSAR scope") and that is a statement
    // about whose erasure request reaches them, not about who may read them.
    // This export is the staff member asking for their OWN data, which is
    // precisely the request that does reach them.
    { field: 'serviceOriginAddress', column: 'service_origin_address', disposition: 'export', reason: 'where this subject starts their working day, possibly their home address — their own personal data, and this export is the subject asking for it' },
    { field: 'serviceOriginLat', column: 'service_origin_lat', disposition: 'export', reason: 'geocode of the subject\'s own routing origin' },
    { field: 'serviceOriginLng', column: 'service_origin_lng', disposition: 'export', reason: 'geocode of the subject\'s own routing origin' },
];

/** Reason attached to a column nobody has classified yet. */
export const UNCLASSIFIED_REASON =
    'UNCLASSIFIED — this column is not in ACCOUNT_EXPORT_CLASSIFICATION. Withheld by default ' +
    'because an unreviewed column could be a credential; classify it in ' +
    'server/lib/compliance/account-export-manifest.ts to export it.';

const BY_FIELD = new Map(ACCOUNT_EXPORT_CLASSIFICATION.map((r) => [r.field, r]));

/** One field held back, and why — surfaced to the subject in the export bundle. */
export interface WithheldField {
    field: string;
    reason: string;
}

/** The identity half of the export bundle. */
export interface RedactedIdentity {
    identity: Record<string, unknown>;
    withheld: WithheldField[];
}

/**
 * Apply the classification to a selected `users` row.
 *
 * Driven by the row's OWN keys rather than by the classification, so a column the
 * classification has never heard of still shows up here (withheld, and named in
 * `withheld`) instead of passing through unnoticed.
 */
export function redactIdentityForExport(row: Record<string, unknown>): RedactedIdentity {
    const identity: Record<string, unknown> = {};
    const withheld: WithheldField[] = [];

    for (const [field, value] of Object.entries(row)) {
        const rule = BY_FIELD.get(field);
        if (rule === undefined) {
            withheld.push({ field, reason: UNCLASSIFIED_REASON });
            continue;
        }
        if (rule.disposition === 'withhold') {
            withheld.push({ field, reason: rule.reason });
            continue;
        }
        identity[field] = value;
    }

    return { identity, withheld };
}

/** What a completeness audit of the classification found. */
export interface AccountExportClassificationAudit {
    /** Live columns with no entry here — an export that has not been ruled on. */
    unclassified: string[];
    /** Entries naming a column the table no longer has — a rule nobody can evaluate. */
    stale: string[];
}

/**
 * Compare the classification against the live column list, both directions.
 *
 * Takes the column names as an argument rather than reading the schema itself,
 * for the reason `check-erasure-manifest.mjs` grew its `--schema-dir` override:
 * the enforcement has to be provable against a SYNTHETIC table, and a checker
 * that can only ever look at the real one cannot be shown to fail. The caller
 * passes `Object.keys(getTableColumns(users))` for the real run and whatever it
 * likes for the proof.
 *
 * The stale direction matters as much as the unclassified one. A rule outliving
 * its column is a decision nobody can check, and it pads the count that makes
 * the whole thing look complete.
 */
export function auditAccountExportClassification(fields: string[]): AccountExportClassificationAudit {
    const live = new Set(fields);
    return {
        unclassified: fields.filter((f) => !BY_FIELD.has(f)),
        stale: ACCOUNT_EXPORT_CLASSIFICATION.filter((r) => !live.has(r.field)).map((r) => r.field),
    };
}
