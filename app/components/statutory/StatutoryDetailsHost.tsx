import { useCallback } from "react";

import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { StatutoryDetailsPanel, type StatutoryDetailsValues } from "./StatutoryDetailsPanel";

/**
 * The statutory details panel, with the write it makes.
 *
 * Extracted from the editor route for the reason `AddGroupInstanceHost` gives:
 * that file is one of the largest in the app and its size ratchet is a standing
 * argument against keeping anything there that can stand on its own. What is
 * here is the wiring — a fetcher, an intent, and the decision not to render.
 *
 * ── `null` MEANS THERE IS NO SUCH PANEL, NOT AN EMPTY ONE ───────────────────
 * The loader gets `null` from an endpoint that 404s for every inspection whose
 * template declares no statutory form, which is almost all of them. Rendering
 * an empty card there would ask most inspectors for a property owner's three
 * phone numbers that nothing would ever print.
 *
 * ── ITS OWN GUARDED SUBMIT ─────────────────────────────────────────────────
 * Not the property-facts fetcher, although both panels sit on the same screen:
 * two panels sharing a fetcher abort each other's in-flight request, and the
 * one that loses is the one whose answer disappears.
 *
 * Guarded rather than raw, because leaving one field and immediately leaving
 * the next fires two blurs a few milliseconds apart, and `fetcher.state` has
 * not flipped by the second one. The guard's in-flight ref has. Its `busy`
 * reaches the panel, which disables the inputs while a write is out — so the
 * refused second submit is visible rather than silent, and the whole-set
 * payload means the one that does land carries every answer anyway.
 */
export function StatutoryDetailsHost({ details }: { details: StatutoryDetailsValues | null }) {
    const { submit, busy } = useGuardedSubmit();
    const onCommit = useCallback((next: StatutoryDetailsValues) => {
        submit(
            { intent: "save-statutory-details", payload: JSON.stringify(next) },
            { method: "POST" },
        );
    }, [submit]);

    if (!details) return null;
    return (
        <div className="mt-8">
            <StatutoryDetailsPanel details={details} saving={busy} onCommit={onCommit} />
        </div>
    );
}
