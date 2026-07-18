/**
 * Track I-a GDPR (spec §5) — the erasure manifest. A schema-annotated catalogue
 * of PII columns and the action to take on a data-subject erasure request,
 * adopting the Fides *pattern* (data categories + masking strategy + decision
 * log) hand-rolled for single-Worker + D1 with zero external SaaS.
 *
 * One entry per PII column. The orchestrator (G2) walks these rules, decides per
 * rule + row-state, executes, and writes one `erasure_log` decision row.
 *
 * G2 fills `ERASURE_MANIFEST`; this scaffold (G1) ships the type + an empty array.
 *
 * Executor: `erasure-orchestrator.ts` — the concrete Drizzle executor that
 * realizes these rules. Binding verified by
 * `tests/unit/erasure-manifest-coverage.spec.ts` (drift guard).
 */

/**
 * A single PII-column erasure rule.
 */
export interface ErasureRule {
    /** Table the column lives on (snake_case DB name). */
    table: string;
    /** Column to act on (snake_case DB name). */
    column: string;
    /** Fideslang-style data category, e.g. 'user.contact.email'. */
    category: string;
    /** Masking strategy for this column on erasure. */
    action: 'delete' | 'null' | 'hash' | 'retain' | 'anonymize';
    /**
     * Required when the action retains/anonymizes evidence rather than deleting
     * it — the GDPR Art. 17(3) exemption invoked. art_17_3_b = legal obligation;
     * art_17_3_e = establishment/exercise/defence of legal claims.
     */
    legalBasis?: 'art_17_3_b' | 'art_17_3_e';
    /**
     * ISO-8601 duration hint, e.g. 'P6Y'. Advisory only — the runtime retention
     * value comes from `tenant_configs.agreement_retention_years`.
     */
    retention?: string;
    /** Row-state predicate restricting which rows this rule applies to. */
    condition?: 'signed_only' | 'draft_only';
}

/**
 * The erasure manifest — one entry per PII COLUMN on an erasure-relevant table.
 *
 * Row-deletion convention (read before editing): the manifest describes
 * COLUMN-LEVEL actions only. When a draft/unsigned envelope must be removed as a
 * ROW, that is expressed by `action: 'delete'` + `condition: 'draft_only'` on a
 * sentinel rule (one per envelope table). The orchestrator treats any
 * `draft_only` delete rule on a table as "delete the matching ROWS" rather than
 * clearing the named column — the `column` on those rules names the locator
 * column (the email we matched on) for documentation, not a column to null.
 * Column-level `anonymize`/`null` rules act in-place on the named column.
 *
 * Signed-agreement PII columns -> `anonymize` + `legalBasis: 'art_17_3_e'`
 * (establishment/exercise/defence of legal claims) + `condition: 'signed_only'`,
 * keeping signature_base64 / signed_at / the audit chain (spec §3 D5).
 */
export const ERASURE_MANIFEST: ErasureRule[] = [
    // ── agreement_signers (signed evidence: anonymize the satellite PII) ──────
    { table: 'agreement_signers', column: 'name',                 category: 'user.name',                   action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y', condition: 'signed_only' },
    { table: 'agreement_signers', column: 'email',                category: 'user.contact.email',          action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y', condition: 'signed_only' },
    { table: 'agreement_signers', column: 'ip_address',           category: 'user.device.ip_address',      action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y', condition: 'signed_only' },
    { table: 'agreement_signers', column: 'user_agent',           category: 'user.device.user_agent',      action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y', condition: 'signed_only' },
    { table: 'agreement_signers', column: 'on_behalf_of',         category: 'user.name',                   action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y', condition: 'signed_only' },
    { table: 'agreement_signers', column: 'on_behalf_disclaimer', category: 'user.contact',                action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y', condition: 'signed_only' },
    // Draft/unsigned signer rows ride with their envelope deletion (below).
    { table: 'agreement_signers', column: 'email',                category: 'user.contact.email',          action: 'delete',    condition: 'draft_only' },

    // ── agreement_requests (envelope) ─────────────────────────────────────────
    // Signed envelope: anonymize the denormalized client identity, keep the seal.
    { table: 'agreement_requests', column: 'client_name',  category: 'user.name',          action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y', condition: 'signed_only' },
    { table: 'agreement_requests', column: 'client_email', category: 'user.contact.email', action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y', condition: 'signed_only' },
    // Draft/unsigned envelope: delete the ROW (locator = client_email).
    { table: 'agreement_requests', column: 'client_email', category: 'user.contact.email', action: 'delete', condition: 'draft_only' },

    // ── inspections (non-agreement client PII: null in-place, current behavior) ─
    { table: 'inspections', column: 'client_name',  category: 'user.name',           action: 'null' },
    { table: 'inspections', column: 'client_email', category: 'user.contact.email',  action: 'null' },
    { table: 'inspections', column: 'client_phone', category: 'user.contact.phone',  action: 'null' },

    // ── contacts (CRM client/agent PII) ───────────────────────────────────────
    // `name` is NOT NULL, and a CRM contact carries no legal-evidence retention
    // basis, so the row is DELETED outright (locator = email) rather than nulled.
    { table: 'contacts', column: 'email', category: 'user.contact.email', action: 'delete' },
];
