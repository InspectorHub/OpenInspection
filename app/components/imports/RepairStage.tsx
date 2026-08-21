import { useState } from "react";
import { Button, Card, Input, Pagination, Table } from "@core/shared-ui";

import type { ProblemRow } from "~/lib/imports-types";
import { m } from "~/paraglide/messages";

/**
 * What each family of entry is called, so "the fourth contact" reads as words
 * rather than as the stored kind. Falls back to the raw value: a family added to
 * the format still has to render.
 */
const ENTITY_LABEL: Record<string, () => string> = {
    contact: m.imports_entity_contact,
    member: m.imports_entity_member,
    template: m.imports_entity_template,
};

function entityLabel(entity: string): string {
    return (ENTITY_LABEL[entity] ?? (() => entity))();
}

/**
 * Whether this entry's faulty field is one a text box can put right.
 *
 * A field holding an OBJECT is not. The only problem an upload can currently
 * produce is a template whose `schema` carries no sections, and that field is a
 * whole inspection form — typing into a box would replace it with the characters
 * typed, and the repair endpoint stores what it is given without re-validating
 * it. A box that destroys the entry it claims to fix is worse than no box.
 */
function isEditable(row: ProblemRow): boolean {
    if (!row.field) return false;
    const current = row.payloadEcho[row.field];
    return current === undefined || current === null || typeof current !== "object";
}

/**
 * What the field holds today, as text, which is what the box opens on.
 *
 * A value with no text form — an object, or nothing at all — opens EMPTY rather
 * than as `[object Object]`. `isEditable` already keeps those out of a box, and
 * this second refusal is what makes that a property of the function rather than
 * of the order the two are called in.
 */
function currentText(row: ProblemRow): string {
    if (!row.field) return "";
    const current = row.payloadEcho[row.field];
    if (typeof current === "string") return current;
    if (typeof current === "number" || typeof current === "boolean") return String(current);
    return "";
}

/**
 * The entries that need a person, and one edit box each.
 *
 * ONE field, not the whole entry: the server reports the first thing wrong with
 * an entry reading down it, so a box per reported field lines up one-to-one with
 * what it said. Editing a whole payload would turn a fill-in-the-blank into a
 * JSON syntax exercise, for somebody with eighty of them to get through.
 *
 * What is SENT is the whole entry with that one field replaced, because the
 * repair endpoint rewrites the payload wholesale — a patch alone would erase
 * every other field of the entry.
 *
 * A suggestion is offered as a button, never applied. It is our guess at what
 * they meant, and applying a guess silently is how the path this replaces
 * imported an email address as everybody's name.
 */
export function RepairStage({
    rows,
    total,
    page,
    pageSize,
    busy,
    onSave,
    onPage,
    onPageSize,
}: {
    rows: ProblemRow[];
    /** How many need a person in total — a page of three is unreadable without it. */
    total: number;
    page: number;
    pageSize: number;
    busy: boolean;
    onSave: (rowId: string, payload: Record<string, unknown>) => void;
    onPage: (page: number) => void;
    onPageSize: (pageSize: number) => void;
}) {
    const [drafts, setDrafts] = useState<Record<string, string>>({});

    const draftFor = (row: ProblemRow) => drafts[row.rowId] ?? currentText(row);

    /**
     * The whole entry with one field replaced — or with that field REMOVED when
     * the box was emptied. "Correct it, or clear it" is the server's own advice
     * for a malformed address, and storing `""` would leave the entry looking
     * answered while still carrying the thing that was wrong with it.
     */
    function send(row: ProblemRow, value: string) {
        if (!row.field) return;
        const next = { ...row.payloadEcho };
        const trimmed = value.trim();
        if (trimmed) next[row.field] = trimmed;
        else delete next[row.field];
        onSave(row.rowId, next);
    }

    return (
        <Card className="p-5 space-y-4">
            <div className="space-y-1">
                <h3 className="text-[15px] font-bold text-ih-fg-1">{m.imports_repair_title()}</h3>
                {/* Count LAST: the catalogue carries no plural variants, and a
                    count-first sentence reads "1 entries" for the commonest
                    case of all. */}
                <p className="text-[12px] text-ih-fg-3">
                    {m.imports_repair_remaining({ count: String(total) })}
                </p>
            </div>

            {/* `Table` owns its own `overflow-x-auto` wrapper. */}
            <div className="rounded-ih-card border border-ih-border">
                <Table<ProblemRow>
                    columns={[
                        {
                            key: "where",
                            label: m.imports_repair_col_where(),
                            // One-based, because the operator is counting rows in
                            // a spreadsheet rather than indexing an array.
                            cell: (r) => (
                                <span className="whitespace-nowrap font-bold text-ih-fg-1">
                                    {`${entityLabel(r.entity)} ${r.position + 1}`}
                                </span>
                            ),
                        },
                        {
                            key: "reason",
                            label: m.imports_repair_col_problem(),
                            cell: (r) => <span className="text-ih-fg-2">{r.reason}</span>,
                        },
                        {
                            key: "value",
                            label: m.imports_repair_col_value(),
                            // An em dash rather than a blank: a field that is
                            // empty is the answer here, and a blank cell reads
                            // as data that failed to load.
                            cell: (r) => <span className="text-ih-fg-3">{r.value || "—"}</span>,
                        },
                        {
                            key: "fix",
                            label: m.imports_repair_col_fix(),
                            cell: (r) => <RepairCell
                                row={r}
                                draft={draftFor(r)}
                                busy={busy}
                                onDraft={(v) => setDrafts((d) => ({ ...d, [r.rowId]: v }))}
                                onSend={(v) => send(r, v)}
                            />,
                        },
                    ]}
                    rows={rows}
                    getRowKey={(r) => r.rowId}
                />
            </div>

            <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                totalPages={Math.max(1, Math.ceil(total / pageSize))}
                onPageChange={onPage}
                onPageSizeChange={onPageSize}
            />
        </Card>
    );
}

/** One entry's edit box, its save, and the suggestion it may be offered. */
function RepairCell({
    row,
    draft,
    busy,
    onDraft,
    onSend,
}: {
    row: ProblemRow;
    draft: string;
    busy: boolean;
    onDraft: (value: string) => void;
    onSend: (value: string) => void;
}) {
    if (!isEditable(row)) {
        return (
            <span className="text-[12px] text-ih-fg-2">{m.imports_repair_not_editable()}</span>
        );
    }
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Input
                aria-label={`${entityLabel(row.entity)} ${row.position + 1} ${row.field ?? ""}`}
                className="w-40"
                value={draft}
                disabled={busy}
                onChange={(e) => onDraft(e.currentTarget.value)}
            />
            <Button
                size="sm"
                variant="secondary"
                // Nothing to save while the box still holds what the entry
                // holds. A live button there posts a write that changes nothing
                // and reports success.
                disabled={busy || draft === currentText(row)}
                onClick={() => onSend(draft)}
            >
                {m.imports_repair_save()}
            </Button>
            {row.suggestion && (
                <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => onSend(row.suggestion as string)}
                >
                    {m.imports_repair_use_suggestion({ suggestion: row.suggestion })}
                </Button>
            )}
        </div>
    );
}
