/**
 * The panel's own view of the workbook question, and its projection onto the
 * one the submit ladder reads.
 *
 * Split out of `StartImportPanel` because it is the one part of that file that
 * is neither markup nor an event handler: a type and the total function that
 * maps it. Keeping it here makes `stageOf` directly assertable without a DOM,
 * and it is the mapping — not the rendering — that decides whether the submit
 * button is enabled.
 */
import type { WorkbookStage } from "~/lib/import-entry-points";
import type { SheetChoice } from "~/lib/xlsx-import";

/**
 * Where the chosen file has got to in the workbook question.
 *
 * Panel-internal, and one state richer than `WorkbookStage`: `ready` carries
 * the sheets to offer and which one is chosen, neither of which the blocked
 * reason has any use for. The mapping between the two is `stageOf` below.
 */
export type WorkbookState =
    | { kind: "none" }
    | { kind: "reading" }
    | { kind: "ready"; sheets: SheetChoice[]; chosen: number | null }
    | { kind: "unreadable" };

export function stageOf(state: WorkbookState): WorkbookStage {
    switch (state.kind) {
        case "none":
            return "not-a-workbook";
        case "reading":
            return "reading";
        case "unreadable":
            return "unreadable";
        case "ready":
            return state.chosen === null ? "pending" : "chosen";
    }
}
