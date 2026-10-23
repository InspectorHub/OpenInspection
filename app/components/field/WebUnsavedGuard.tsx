import { UnsavedChangesBlocker } from "@core/field-ui/components/editor/UnsavedChangesBlocker";
import { useUnsavedChanges } from "~/hooks/useUnsavedChanges";

/**
 * The web implementation of the editor's `renderUnsavedGuard` slot: while `atRisk` is true it arms the
 * browser's close prompt and the router blocker, and shows the stay-or-leave dialog when the router blocks a
 * navigation. It renders nothing otherwise.
 */
export function WebUnsavedGuard({ atRisk }: { atRisk: boolean }) {
    const { blocker, confirmLeave, cancelLeave } = useUnsavedChanges(atRisk);
    return <UnsavedChangesBlocker open={blocker.state === "blocked"} onStay={cancelLeave} onLeave={confirmLeave} />;
}
