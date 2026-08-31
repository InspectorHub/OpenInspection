import { GroupInstanceDrawer } from "./GroupInstanceDrawer";
import type { EditorGroup } from "~/lib/editor/statutory-groups";

/**
 * The drawer that records one more instance of a repeated block than the form
 * prints slots for.
 *
 * Extracted from the editor route, which is one of the largest files in the app
 * and whose size ratchet is a standing argument against keeping anything here
 * that can stand on its own. The block it replaced was an inline IIFE that
 * looked a group up by id and rendered nothing when it missed -- reasoning, in
 * a file that should only wire things together.
 *
 * The index is always the group's capacity: a printed slot's value comes from a
 * binding, and accepting a second writer for one would give a box on an
 * authority's form two sources with nothing to say which it carried. The server
 * refuses an index inside the printed range for that reason, so the drawer never
 * offers one.
 */
export function AddGroupInstanceHost({
    groups,
    groupId,
    saving,
    onClose,
    onSave,
}: {
    /** Every repeated block this form declares, or none. */
    groups: readonly EditorGroup[] | undefined;
    /** Which block is having an instance added. `null` closes the drawer. */
    groupId: string | null;
    saving: boolean;
    onClose: () => void;
    onSave: (group: EditorGroup, fields: Record<string, string>) => void;
}) {
    if (!groups || groupId === null) return null;
    const group = groups.find((g) => g.id === groupId);
    if (!group) return null;

    return (
        <GroupInstanceDrawer
            open
            group={group}
            index={group.capacity}
            saving={saving}
            onClose={onClose}
            onSave={(fields) => onSave(group, fields)}
        />
    );
}
