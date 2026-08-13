/**
 * Privacy P3 — the COVERAGE DISCLOSURE that rides `reply.subject.erased` back to
 * the portal DSAR console.
 *
 * Portal marks a DSAR `completed` only once this block has been stored, because
 * "completed" with nothing behind it is an affirmative claim that everything
 * belonging to the subject was erased. That claim is false while any PII column
 * is uncatalogued, and it becomes false again the next time one is added. Portal
 * cannot compute the block itself: the catalogue lives in this repo, behind a
 * submodule boundary nothing over there can import. So it exists only if core
 * sends it, and this module is the only thing that builds one.
 *
 * WHAT THIS DISCLOSES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * `executedTables` is derived from the RUN, not from the catalogue: the tables
 * whose decisions the orchestrator actually recorded. A table absent from that
 * list was either not reached or matched no rows, and the disclosure does not
 * distinguish those — `runErasure` records a decision only when a step changed
 * something (`count > 0`) or threw. Read it as "these were touched", never as
 * "the rest were checked and were clean".
 *
 * `manifestRuleCount` / `outOfScopeCount` describe the CATALOGUE
 * (`erasure-manifest.ts` + `erasure-out-of-scope.ts`), which is a parallel
 * document, not the code path that executed. `catalogueIsAdvisory` is a literal
 * `true` on the wire so a console cannot render the catalogue numbers as if they
 * were run results — the flag is what forces a reader to keep the two apart.
 *
 * `pendingRules` carries IDENTIFIERS, not just a count. The manifest currently
 * holds rules that record a decision no code enforces yet (the property-address
 * family: catalogued `retain` with a bounded period, but nothing expires an
 * inspection address today). A flat "N rules cover this subject" would report
 * those as covered — the same false record in a new place — so the identifiers
 * travel with their count and portal asserts the two agree.
 *
 * No number here is asserted against a literal, in this repo or the other one.
 * These move whenever the catalogue does, and a baked-in expectation would be
 * stale within the month.
 */
import { ERASURE_MANIFEST } from './erasure-manifest';
import { ERASURE_OUT_OF_SCOPE } from './erasure-out-of-scope';
import type { ErasureDecision } from './erasure-orchestrator';

/**
 * The axis a core erasure matches a data subject ON — a DISCLOSURE, not an echo
 * of whatever the caller supplied.
 *
 * `runErasure` locates the subject by email in every one of its predicates:
 * `agreement_requests.client_email`, `agreement_signers.email`, `contacts.email`,
 * `invoices.client_email`, `concierge_confirm_tokens.client_email`,
 * `inspection_access_tokens.recipient_email`, `inspection_requests.client_email`,
 * `repair_requests.created_by_ref`. There is no phone-keyed query anywhere in it,
 * which is why `cmd.subject.erase` carries no phone at all.
 *
 * Changing this constant is the LAST step of growing a phone axis, never the
 * first: it is what the compliance record ends up saying, so it must not be able
 * to describe a query that does not exist.
 */
export const ERASURE_SUBJECT_AXIS = 'email';

/** The wire shape portal stores verbatim as `dsar_requests.coverage_json`. */
export interface ErasureCoverageDisclosure {
    manifestRuleCount: number;
    outOfScopeCount: number;
    pendingEnforcementCount: number;
    pendingRules: string[];
    executedTables: string[];
    /** Literal `true`: the catalogue counts above describe a document, not this run. */
    catalogueIsAdvisory: true;
    subjectAxis: string;
}

/**
 * Catalogued-but-unenforced rules, as `table.column` identifiers.
 *
 * Sorted and de-duplicated so the disclosure is stable across runs — a
 * compliance record that reorders itself for no reason invites the reader to
 * treat a real change as noise. De-duplication matters because the manifest
 * addresses a column once per rule, and a column may legitimately carry two
 * rules with different row-state conditions.
 */
function pendingRuleIds(): string[] {
    const ids = ERASURE_MANIFEST
        .filter((r) => r.enforcementStatus === 'pending')
        .map((r) => `${r.table}.${r.column}`);
    return [...new Set(ids)].sort();
}

/**
 * Build the disclosure for one completed erasure run.
 *
 * `decisions` comes straight from `ErasureSummary.decisions`. A step that THREW
 * is recorded there with an `error` and a zero count; those tables are excluded
 * from `executedTables` — an errored step did not touch the table, and listing
 * it would be the disclosure asserting exactly the thing it exists to prevent.
 * The failure is not lost: the decision (error string included) rides the same
 * reply and portal stores it. The applier additionally refuses to reply at all
 * on a partial run — see `apply-subject-commands.ts`.
 */
export function buildErasureCoverage(
    decisions: ErasureDecision[],
    subjectAxis: string = ERASURE_SUBJECT_AXIS,
): ErasureCoverageDisclosure {
    const pendingRules = pendingRuleIds();
    const executedTables = [...new Set(
        decisions.filter((d) => d.error === undefined).map((d) => d.table),
    )].sort();
    return {
        manifestRuleCount: ERASURE_MANIFEST.length,
        outOfScopeCount: ERASURE_OUT_OF_SCOPE.length,
        pendingEnforcementCount: pendingRules.length,
        pendingRules,
        executedTables,
        catalogueIsAdvisory: true,
        subjectAxis,
    };
}
