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
 * The erasure manifest. Empty in G1; G2 populates the erasure-relevant tables
 * (agreement_requests, agreement_signers, inspections client-PII columns,
 * contacts, + whatever eraseClientData already touches).
 */
export const ERASURE_MANIFEST: ErasureRule[] = [];
