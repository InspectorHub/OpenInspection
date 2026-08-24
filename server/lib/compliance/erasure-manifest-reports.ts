/**
 * The erasure rules for a delivered REPORT — the document, the record that it
 * was viewed, and the courtesy translation of it.
 *
 * A part of `ERASURE_MANIFEST`, not a second manifest. It is spread back into
 * that array at the position these rules already occupied, because ORDER IS
 * BEHAVIOUR here: `report_views` rows are located through
 * `inspection_access_tokens`, so they must be listed and deleted before the
 * tokens that are the only route back to the subject.
 *
 * ## Why a separate file at all
 *
 * `erasure-manifest.ts` sits at its large-file cap. A rule that will not fit is
 * not a reason to raise the cap on an accountability record — it is a reason to
 * cut one along a subject boundary, and "everything about a delivered report"
 * is a boundary that will still make sense in a year.
 *
 * ⚠️ `scripts/check-erasure-manifest.mjs` reads the manifest as SOURCE TEXT.
 * Moving rules into another file it does not read would halve what it sees
 * while it went on reporting a pass — which is the failure this codebase keeps
 * rediscovering. The gate now resolves every spread inside `ERASURE_MANIFEST`
 * and HARD-FAILS on one it cannot find, so this file is not merely added to a
 * list: a future split cannot go blind either.
 *
 * The prose conventions of the parent file apply here unchanged. In particular:
 * a premise stated in a comment is not evidence. Before relying on one of these
 * paragraphs, go read what writes the column.
 */
import type { ErasureRule } from './erasure-manifest';

/** @gateConsumed spread into `ERASURE_MANIFEST`; read as source text by the gate. */
export const REPORT_DELIVERABLE_ERASURE_RULES: ErasureRule[] = [
    // ── report_views (#271) ───────────────────────────────────────────────────
    // Delivery-confirmation counters: this recipient rendered this order's
    // report page, first/last, this many times. A behavioural fact about an
    // identified person, and the PII heuristic matches NOTHING here — not
    // `view_count`, not `first_viewed_at`, not `access_token_id`. The gate was
    // green over this table the entire time it existed.
    //
    // DELETE the ROWS. Zeroing the counters is not an option: an all-zero row
    // still asserts that this person was sent this document. Locator =
    // `access_token_id`, the only route back to the subject (there is no email
    // on this table), which is why the orchestrator resolves the token ids and
    // deletes here BEFORE deleting `inspection_access_tokens`.
    //
    // The action is not a new judgement. `docs/compliance/report-view-lia.md`
    // condition 7 already required it ("the row is catalogued for erasure in the
    // same change that creates it, and the erasure orchestrator is wired to
    // it... the subject's rows must be removed before their access tokens are"),
    // and the schema comment on `reportViews` states the same. What was missing
    // was any code or catalogue entry that did it — the condition read as met
    // because two documents said so and nothing checked.
    { table: 'report_views', column: 'access_token_id', category: 'user.behavior', action: 'delete' },

    // ── reports ───────────────────────────────────────────────────────────────
    // A report is findings about a named person's property. `title` is written
    // by the system, never by a person composing free text about this client:
    // it is either the literal 'Inspection Report' (`inspection/reports.ts`) or
    // a snapshot of a service line's name taken from the tenant's own catalogue
    // (`inspection/report-generation.ts`, both the insert and the adoption
    // update). No route writes it — the only other writer is the erasure
    // executor performing this very rule.
    //
    // Erased in place rather than deleted: the row is the spine of a signed,
    // delivered document, and removing it would strand the version chain that
    // proves what was delivered. A catalogue service name is tenant-authored,
    // so it cannot be assumed free of identifiers, and clearing a title costs
    // nothing.
    //
    // AMENDMENT HISTORY
    //   Previous rationale: "`title` is the one free-text column a human writes
    //     — it routinely carries the address ("123 Oak St — Radon")."
    //   Correction date:    2026-08-07
    //   Why:                factually wrong about this codebase, in both halves.
    //     No human writes it and no API can edit it, so it cannot routinely
    //     carry a per-property address. Evidence: the two writers named above,
    //     read 2026-08-07 (E2 — verified in source, not inferred from a plan).
    //   Impact:             NONE on the processing decision. The action stays
    //     the same one (it was spelled `anonymize` at the time and is now
    //     `erase_in_place`), and the basis and the period are unchanged. What
    //     changes is the reason recorded for it.
    //   Kept rather than overwritten: an accountability record under Art. 5(2)
    //     that quietly deletes a mistake is worth less than one that shows the
    //     mistake was found and corrected.
    { table: 'reports', column: 'title', category: 'user.address', action: 'erase_in_place', legalBasis: 'art_17_3_e', retention: 'P6Y' },
    // `inspector_narrative` IS what the title turned out not to be: prose a person
    // composes about this property for this client, so it can carry names and
    // occupancy detail, none of it machine-detectable — the population
    // `docs/compliance/erasure-heuristic-limits.md` says the gate cannot reach.
    // Cleared WHOLESALE, the `audit_logs.metadata` call: identifiers cannot be
    // stripped out of prose. The ROW survives (spine of a signed document).
    // ⚠️ Safe for the integrity chain only because the narrative is NOT in
    // `report_versions.snapshot_json` (`report-version.service.ts` captures the
    // inspections row, results, units, inspectors, style profile — not `reports`).
    // Put it in the snapshot and this rule must be re-decided: an erasure would
    // then either leave the prose inside a signed blob or break its signature.
    { table: 'reports', column: 'inspector_narrative', category: 'user.freetext', action: 'erase_in_place', legalBasis: 'art_17_3_e', retention: 'P6Y' },

    // ── report_translations (#23) ─────────────────────────────────────────────
    // A courtesy translation of one report: inspector prose about a named
    // person's property, rendered into another language. DERIVED personal data,
    // and the gap was that a derived copy of governed data was itself
    // ungoverned — its parent columns `reports.title` and
    // `reports.inspector_narrative` are both answered two rules above.
    //
    // `lint:erasure` was green over this table for its whole life and could not
    // have been anything else: PII_HEURISTIC matches none of its eleven column
    // names — not `content`, not `locale`, not `source`, not `english_hash`.
    // Found by reading, not by anything going red.
    //
    // DELETE the row, not `erase_in_place` on the column, and both were
    // defensible so the choice is recorded rather than left open. The row
    // doubles as the opt-in record: no row = never translated, a row whose hash
    // matches = live, a row whose hash does not = previously translated and
    // currently withheld. Deleting converts the third state into the first, and
    // that is the right conversion — once the English the translation described
    // has been erased around it, "never translated" is the state the report is
    // genuinely in. A workflow convenience is not a reason to keep a derived
    // copy of a subject's data through their erasure request.
    //
    // No `legalBasis`: none is claimed, because nothing is retained. Located
    // through `reports.inspection_id` (the table carries no identifier of a
    // person at all) — see `erase-report-artifacts.ts`.
    { table: 'report_translations', column: 'content', category: 'user.freetext', action: 'delete' },
];
