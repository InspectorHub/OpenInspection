/**
 * #275 — repair-note quick phrases: seeded defaults and the NULL-vs-[] rule.
 *
 * The seeds are PRODUCT strings, so they live in the message catalog and are
 * resolved on the client, per request — which is also why the API returns the
 * stored column verbatim (`null` when unset) instead of substituting them
 * server-side. The moment a tenant edits the list the values become tenant
 * content and leave the catalog's scope entirely; the report's courtesy
 * translation layer handles them like any other note text.
 */
import { m } from "~/paraglide/messages";

/**
 * Shown to a tenant who has never configured the list. Built inside a function
 * (not a module const) so the localized message thunks resolve per request,
 * not once at import — the same reason `gatedStates()` in RepairBuilderSection
 * is a function.
 */
export function seedQuickPhrases(): string[] {
  return [
    // ⚠️ These used to be "Repair requested" / "Replacement requested", which
    // #275 turned into a duplicate: the structured REQUESTED ACTION field now
    // owns what the buyer is asking for, so a phrase that also states it lets
    // the same request be made twice, in two places, with nothing reconciling
    // them. The note's remaining job is the RATIONALE — conditions on how the
    // work is done and what evidence is wanted, which no structured field
    // carries. Two phrases, so the "[] means the tenant switched them off"
    // distinction below still has a non-empty default to be distinct from.
    m.repair_quick_phrase_default_licensed(),
    m.repair_quick_phrase_default_invoice(),
  ];
}

/**
 * The phrases to actually render, given what the tenant stored.
 *
 * `null`/`undefined` = never configured → the seeds.
 * `[]`               = the tenant removed them all → NO buttons.
 *
 * Those two are NOT the same state, and this is the only place that decides so.
 * Collapsing them (`custom?.length ? custom : seeds`) silently takes away the
 * tenant's only way to turn the feature off, and nobody notices, because the
 * defaults look intentional.
 *
 * `seeds` is a parameter rather than a call to `seedQuickPhrases()` so the rule
 * itself is pure and testable without a locale in scope.
 */
export function resolveQuickPhrases(
  custom: string[] | null | undefined,
  seeds: string[],
): string[] {
  if (custom == null) return seeds;
  return custom.map((p) => p.trim()).filter(Boolean);
}

/** Split a newline-separated editor value into the stored phrase array. */
export function parseQuickPhraseLines(value: string): string[] {
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
