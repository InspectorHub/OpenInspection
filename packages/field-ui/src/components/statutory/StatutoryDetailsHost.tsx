import { useCallback } from "react";

import { useFieldCommand } from "../../context";
import { StatutoryDetailsPanel, type StatutoryDetailsValues } from "./StatutoryDetailsPanel";

/**
 * The statutory details panel, with the write it makes.
 *
 * Extracted from the editor route for the reason `AddGroupInstanceHost` gives:
 * that file is one of the largest in the app and its size ratchet is a standing
 * argument against keeping anything there that can stand on its own. What is
 * here is the wiring — a command, and the decision not to render.
 *
 * ── `null` MEANS THERE IS NO SUCH PANEL, NOT AN EMPTY ONE ───────────────────
 * The loader gets `null` from an endpoint that 404s for every inspection whose
 * template declares no statutory form, which is almost all of them. Rendering
 * an empty card there would ask most inspectors for a property owner's three
 * phone numbers that nothing would ever print.
 *
 * ── ITS OWN COMMAND CHANNEL ─────────────────────────────────────────────────
 * Not the property-facts write, although both panels sit on the same screen:
 * two panels sharing one channel would drop each other's write while one is in
 * flight, and the one that loses is the one whose answer disappears.
 *
 * Guarded, because leaving one field and immediately leaving the next fires two
 * blurs a few milliseconds apart, before any render could show a busy state.
 * `useFieldCommand` decides on a synchronous in-flight ref. Its `busy` reaches
 * the panel, which disables the inputs while a write is out — so the refused
 * second write is visible rather than silent, and the whole-set payload means
 * the one that does land carries every answer anyway.
 */
export function StatutoryDetailsHost({
    inspectionId,
    details,
}: {
    inspectionId: string;
    details: StatutoryDetailsValues | null;
}) {
    const { run, busy } = useFieldCommand(inspectionId);
    const onCommit = useCallback((next: StatutoryDetailsValues) => {
        void run({ type: "save-statutory-details", payload: next });
    }, [run]);

    if (!details) return null;
    return (
        <div className="mt-8">
            <StatutoryDetailsPanel details={details} saving={busy} onCommit={onCommit} />
        </div>
    );
}
