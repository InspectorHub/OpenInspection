// server/lib/report-views.gate.ts
/**
 * 🔒 OI #271 — the report-view counter is OFF, and this file is the whole reason.
 *
 * `docs/compliance/report-view-lia.md` §3.2 says of the Art. 13 disclosure:
 * *"Remove the disclosure and this assessment fails."* The disclosure is not a
 * courtesy sitting beside the balancing test, it is load-bearing INSIDE it.
 * Conditions **4** (the notice travels with the message that carries the link),
 * **5** (a system-rendered block tenants cannot edit away) and **6** (the
 * inspector surface pairs "opened" with delivery status) are all still unbuilt,
 * so a counter that runs today runs OUTSIDE its own assessment. That is the same
 * structural defect the 2026-08-07 amendment fixed one condition over, for the
 * Art. 21 objection: the mechanism cannot ship after the thing it qualifies.
 *
 * ## Why a compile-time constant and not config
 *
 * A capability that is closed because nobody provisioned a secret is closed by
 * ACCIDENT — that was the managed-AI lesson, and the fix there was to make the
 * refusal explicit rather than emergent. An env var, a `tenant_configs` row or a
 * feature flag can all be flipped by an operational action taken for some other
 * reason, by someone who has never read the assessment. This constant cannot:
 * turning the counter on requires editing source, which means a commit, which
 * means a reviewer.
 *
 * Deliberately NOT parameterised. No argument, no env read, no tenant lookup —
 * the moment this takes an input it stops being a decision and becomes a
 * setting, and a setting has an operator.
 *
 * ## 🔴 Delete this file in the change that lands conditions 4, 5 and 6
 *
 * Together with its import in `report-views.ts`, the `'disabled'` outcome, and
 * `tests/unit/client-portal/view-confirmation-default-off.spec.ts` — and drop
 * the `vi.mock` at the head of `view-confirmation.spec.ts` so that suite runs
 * against the real constant again.
 *
 * A flag left behind after its reason expires becomes a SECOND definition of
 * whether the feature exists, and the two definitions disagree the first time
 * someone reads only one of them. This gate is scaffolding with a demolition
 * date, not an option the product offers.
 */

/**
 * Whether `recordReportView` may write anything at all.
 *
 * Annotated `: boolean` rather than left to infer the `false` literal so the
 * disabled branch in `report-views.ts` reads as a real condition to
 * `@typescript-eslint/no-unnecessary-condition` — the alternative is a
 * suppression comment on the one line that must never be quietly deleted.
 */
export const REPORT_VIEW_COUNTING_ENABLED: boolean = false;
