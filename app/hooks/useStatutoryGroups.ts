import { useMemo } from "react";
import {
    declaresStatutoryForm,
    deriveEditorGroups,
    formBoundItemIds,
    type EditorGroup,
} from "~/lib/editor/statutory-groups";
import { formCompleteness, type FormCompleteness } from "~/lib/editor/form-completeness";

/**
 * The repeated blocks this inspection's form prints, or none.
 *
 * A thin wrapper over `deriveEditorGroups` so the editor route stays a place
 * where things are wired rather than worked out -- it is already one of the
 * largest files in the app, and its size ratchet is a standing argument against
 * adding reasoning to it.
 *
 * Returns `undefined` rather than an empty array when there is nothing, because
 * that is what the item list wants: absent means "behave exactly as you always
 * have", which is what keeps every narrative template untouched.
 */
export function useStatutoryGroups(
    templateSnapshot: unknown,
): readonly EditorGroup[] | undefined {
    return useMemo(() => {
        const declaration = (templateSnapshot as {
            statutoryForm?: Parameters<typeof deriveEditorGroups>[0];
        } | null)?.statutoryForm;
        const groups = deriveEditorGroups(declaration);
        return groups.length > 0 ? groups : undefined;
    }, [templateSnapshot]);
}

/**
 * May this inspection's structure be edited at all?
 *
 * False whenever the snapshot declares a statutory form, because the server
 * refuses every structural edit on one with a 403. The editor uses this to stop
 * handing out controls that cannot work -- a button that always fails teaches
 * the inspector nothing except that the software is unreliable, and it teaches
 * him mid-job.
 */
export function useStructuralEditingAllowed(templateSnapshot: unknown): boolean {
    return useMemo(() => !declaresStatutoryForm(templateSnapshot), [templateSnapshot]);
}

/**
 * How much of this inspection's statutory form is answered, or `null`.
 *
 * `null` covers both "this template declares no form" and "it declares one that
 * binds nothing", because the caller does the same thing with either: it shows
 * no counter at all. A zero-of-zero counter would report progress on a document
 * that has no boxes.
 *
 * Here rather than in the editor route for the same reason as the hook above:
 * the route is a place where things are wired, not worked out.
 */
export function useStatutoryFormProgress(
    templateSnapshot: unknown,
    results: Parameters<typeof formCompleteness>[1],
): FormCompleteness | null {
    return useMemo(() => {
        const declaration = (templateSnapshot as {
            statutoryForm?: Parameters<typeof formBoundItemIds>[0];
        } | null)?.statutoryForm;
        if (!declaration) return null;
        const done = formCompleteness(formBoundItemIds(declaration), results);
        return done.total > 0 ? done : null;
    }, [templateSnapshot, results]);
}
