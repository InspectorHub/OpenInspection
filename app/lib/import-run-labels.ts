/**
 * What an import run is called, and what its state is called.
 *
 * One module because TWO screens name the same run: the list says which run a
 * row is, and the run's own page says which run you have open. Two copies of
 * these tables is how one run comes to be called "Team members" in the list and
 * something else on its own page — and, worse, how a state added to the
 * lifecycle gets a label in one place and silently falls through to a default
 * in the other.
 *
 * Unlike `import-entry-points.ts` and `import-wizard-steps.ts` next door, this
 * module DOES read the message catalogue. Those two hold rules, which are
 * asserted without a DOM and therefore take their sentences from the caller;
 * this one holds nothing but names, and a caller-supplied name would just be
 * these tables moved back into both screens.
 *
 * Every lookup FALLS BACK rather than throwing. A run created before an intent
 * or a state existed still has to render — a page that throws on an unknown
 * string turns a stale row into a blank screen.
 */
import type { PillTone } from "@core/shared-ui";

import { m } from "~/paraglide/messages";

/** What each entry point brings over. */
const INTENT_LABEL: Record<string, () => string> = {
    "templates.create": m.imports_intent_templates_create,
    "templates.overwrite": m.imports_intent_templates_overwrite,
    "contacts.import": m.imports_intent_contacts_import,
    "members.invite": m.imports_intent_members_invite,
    "assisted.full": m.imports_intent_assisted_full,
};

/** Every state on the batch lifecycle axis that a person can be looking at. */
const STATUS_LABEL: Record<string, () => string> = {
    staged: m.imports_status_staged,
    applying: m.imports_status_applying,
    applied: m.imports_status_applied,
    partially_applied: m.imports_status_partially_applied,
    reverted: m.imports_status_reverted,
    partially_reverted: m.imports_status_partially_reverted,
    abandoned: m.imports_status_abandoned,
    needs_assistance: m.imports_status_needs_assistance,
    expired: m.imports_status_expired,
};

/**
 * The chip's colour per state. `monitor` is the one that means "this is waiting
 * for you"; `defect` means part of it did not land.
 *
 * These are Pill's tone names, which are NOT the DS token names — Pill maps
 * `sat`→ok, `monitor`→watch, `defect`→bad internally. A tone spelled with the
 * token name instead compiles to an undefined key and paints nothing.
 *
 * The four settled states share `info` rather than taking Pill's muted greys,
 * for a measured reason: `gen` / `ni` / `neutral` are all
 * `bg-ih-bg-muted text-ih-fg-3`, which composites to 4.34:1 on a card at the
 * chip's 11px — under AA, and invisible to `lint:contrast`, which reads the
 * stylesheet and never composites the chip over the surface beneath it. The
 * distinction between "Undone", "Abandoned" and "Expired" is carried by the
 * word, which is the part that actually says what happened.
 */
const STATUS_TONE: Record<string, PillTone> = {
    staged: "monitor",
    applying: "info",
    applied: "sat",
    partially_applied: "defect",
    reverted: "info",
    partially_reverted: "defect",
    abandoned: "info",
    needs_assistance: "monitor",
    expired: "info",
};

export function importIntentLabel(intent: string): string {
    return (INTENT_LABEL[intent] ?? m.imports_intent_assisted_full)();
}

export function importStatusLabel(status: string): string {
    return (STATUS_LABEL[status] ?? m.imports_status_staged)();
}

export function importStatusTone(status: string): PillTone {
    return STATUS_TONE[status] ?? "info";
}
