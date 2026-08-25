import { Select } from "@core/shared-ui";

import type { SheetChoice } from "~/lib/xlsx-import";
import { m } from "~/paraglide/messages";

/**
 * Which sheet of the chosen workbook holds the list.
 *
 * ── Why it is here and not a wizard step ────────────────────────────────────
 * A run does not exist yet. This sits on the page where the file is chosen,
 * before anything has been posted, so the sheet is a property of the DRAFT —
 * exactly like the declared vendor and the two agreements, all of which already
 * live in `StartImportPanel`'s state. The workbook never reaches the server, so
 * a step keyed on a stored run could never answer this for any run that has
 * ever existed.
 *
 * ── ⚠️ NOT a form field ─────────────────────────────────────────────────────
 * It carries no `name`, so nothing about the sheet is on the wire. The choice
 * is applied by REWRITING the file input, which means there is exactly one
 * value in the request describing what was uploaded, and no second one that
 * could disagree with it. A `name="sheet"` here would create that second value
 * the moment anything went wrong with the conversion.
 *
 * ── Nothing at all for one answer ───────────────────────────────────────────
 * Below two sheets this renders null and the panel converts silently, naming
 * the sheet it used. Same rule `defaultImportSourceFor` states in prose: a
 * control with one option is not a question, and making somebody click it
 * teaches them the control does not matter.
 */
export function SheetPicker({
    sheets,
    value,
    onPick,
}: {
    /** The sheets with rows, in workbook order. */
    sheets: SheetChoice[];
    /** Index into `workbook.worksheets`, or null while unanswered. */
    value: number | null;
    onPick: (sheetIndex: number) => void;
}) {
    if (sheets.length < 2) return null;

    return (
        <Select
            data-testid="import-start-sheet"
            label={m.imports_sheet_label()}
            hint={m.imports_sheet_help()}
            value={value === null ? "" : String(value)}
            onChange={(e) => {
                // Narrowed against the offered sheets rather than parsed and
                // trusted: an empty placeholder parses to 0, which is a
                // perfectly valid worksheet index and the wrong answer.
                const picked = sheets.find((s) => String(s.index) === e.currentTarget.value);
                if (picked) onPick(picked.index);
            }}
        >
            {/* No default. A default here silently decides which sheet becomes
                the list, and it is wrong exactly for the person whose data is
                not on the first sheet. */}
            <option value="">{m.imports_sheet_unchosen()}</option>
            {sheets.map((sheet) => (
                <option key={sheet.index} value={String(sheet.index)}>
                    {sheet.name}
                </option>
            ))}
        </Select>
    );
}
