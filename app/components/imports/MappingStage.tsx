import { useState } from "react";
import { Button, Card, Select, Table } from "@core/shared-ui";

import {
    IMPORT_CONTACT_TYPES,
    IMPORT_MEMBER_ROLES,
    type AdapterInspection,
    type ColumnMapping,
    type ContactMapping,
    type MemberMapping,
    type StageMapping,
    type ValueSource,
} from "~/lib/imports-types";
import { TemplateMappingForm } from "./TemplateMappingForm";
import { m } from "~/paraglide/messages";

/** "Not in this file" — the answer for an optional field the export does not carry. */
const NOT_IN_FILE = "";

/**
 * Both closed lists are named by the words the rest of the product uses for
 * them, rather than by their stored values. A dropdown reading `client / agent /
 * other` is the storage layer showing through, and it is the only place in this
 * product a person would meet those spellings.
 *
 * Both FALL BACK to the raw value. `IMPORT_MEMBER_ROLES` is derived from the
 * taxonomy rather than typed out, precisely so a role added there appears here
 * on the day it exists — a lookup that threw would turn that into a blank page.
 */
const CONTACT_TYPE_LABEL: Record<string, () => string> = {
    client: m.contacts_type_client,
    agent: m.contacts_type_agent,
    other: m.contacts_type_other,
};
const MEMBER_ROLE_LABEL: Record<string, () => string> = {
    owner: m.settings_team_role_owner_name,
    manager: m.settings_team_role_manager_name,
    inspector: m.settings_team_role_inspector_name,
};

/**
 * One field's source as a single select value.
 *
 * A column choice and a one-answer-for-everyone choice are offered by ONE
 * control, because they are one question — "where does each entry's type come
 * from" — and two controls would need a third control to say which of them is
 * in charge. The prefix is what keeps a column literally named `client`
 * distinguishable from the type `client`.
 */
function encodeSource<T extends string>(source: ValueSource<T>): string {
    return "fixed" in source ? `fixed:${source.fixed}` : `column:${source.column}`;
}

function decodeSource<T extends string>(
    raw: string,
    allowed: readonly T[],
    current: ValueSource<T>,
): ValueSource<T> {
    if (raw.startsWith("column:")) return { column: raw.slice("column:".length) };
    const value = raw.slice("fixed:".length);
    // An unrecognised fixed value keeps what was there. The select cannot
    // produce one; a stored mapping written before the list moved on can.
    return allowed.includes(value as T) ? { fixed: value as T } : current;
}

/**
 * Which of the operator's columns holds what.
 *
 * The screen this replaces let nothing be changed, and the mapping behind it
 * guessed — falling back to the first column for the name when no header looked
 * like one, so a file whose first column was an email address imported an email
 * address as everybody's name, silently.
 *
 * Three consequences are visible here. An unguessed field is EMPTY rather than
 * filled with a guess, so an unanswered question looks unanswered, and the save
 * control states its own condition as a sentence instead of merely greying out.
 * An optional field left empty is DROPPED from the mapping rather than sent as
 * an empty column name — "" is not a column, and sending it asks the adapter to
 * find one. And the sample of the file sits directly above the controls,
 * because "which column holds the name" is not answerable without the file in
 * view.
 */
export function MappingStage({
    inspection,
    mapping,
    busy,
    onApply,
}: {
    inspection: AdapterInspection;
    mapping: StageMapping;
    busy: boolean;
    onApply: (mapping: StageMapping) => void;
}) {
    // Two forms, dispatched here and holding NO state of their own at this
    // level. A single component branching inside itself would run its hooks
    // conditionally, and the two arms genuinely share nothing: one is about
    // which column holds what, the other about what a set of words means.
    if (mapping.kind === "template") {
        // Both halves narrowed together. A template mapping beside a columns
        // inspection is a report whose two halves disagree — it cannot be
        // produced by the server, and rendering the column form against it
        // would print an empty table instead of saying so.
        if (inspection.kind !== "template") return null;
        return (
            <TemplateMappingForm
                inspection={inspection}
                mapping={mapping}
                busy={busy}
                onApply={onApply}
            />
        );
    }
    if (inspection.kind !== "columns") return null;
    return (
        <ColumnMappingForm
            inspection={inspection}
            mapping={mapping}
            busy={busy}
            onApply={onApply}
        />
    );
}

/** The uploaded file's columns and a sample of its rows. */
type ColumnsInspection = Extract<AdapterInspection, { kind: "columns" }>;

function ColumnMappingForm({
    inspection,
    mapping,
    busy,
    onApply,
}: {
    inspection: ColumnsInspection;
    mapping: ColumnMapping;
    busy: boolean;
    onApply: (mapping: ColumnMapping) => void;
}) {
    const [draft, setDraft] = useState<ColumnMapping>(mapping);

    const columnOptions = [
        { value: NOT_IN_FILE, label: m.imports_mapping_none() },
        ...inspection.columns.map((c) => ({ value: c, label: c })),
    ];

    function setContact(patch: Partial<ContactMapping>) {
        setDraft((d) => (d.kind === "contacts" ? { ...d, mapping: { ...d.mapping, ...patch } } : d));
    }
    function setMember(patch: Partial<MemberMapping>) {
        setDraft((d) => (d.kind === "members" ? { ...d, mapping: { ...d.mapping, ...patch } } : d));
    }

    /** Strips every optional field the operator left unanswered. */
    function cleaned(d: ColumnMapping): ColumnMapping {
        if (d.kind === "contacts") {
            const out: ContactMapping = { name: d.mapping.name, type: d.mapping.type };
            if (d.mapping.email) out.email = d.mapping.email;
            if (d.mapping.phone) out.phone = d.mapping.phone;
            if (d.mapping.agency) out.agency = d.mapping.agency;
            if (d.mapping.notes) out.notes = d.mapping.notes;
            return { kind: "contacts", mapping: out };
        }
        const out: MemberMapping = { email: d.mapping.email, role: d.mapping.role };
        if (d.mapping.name) out.name = d.mapping.name;
        return { kind: "members", mapping: out };
    }

    /**
     * The one column this family cannot be imported without, and the sentence
     * naming it. Contacts are found by their name; an invitation is delivered
     * to an address, so its required column is a different one — a single
     * "choose the name column" would be a true-sounding lie on that form.
     */
    const missing = draft.kind === "contacts"
        ? (draft.mapping.name ? null : m.imports_mapping_needs_name())
        : (draft.mapping.email ? null : m.imports_mapping_needs_email());

    return (
        <Card className="p-5 space-y-4">
            <div className="space-y-1">
                <h3 className="text-[15px] font-bold text-ih-fg-1">{m.imports_mapping_title()}</h3>
                <p className="text-[12px] text-ih-fg-3 max-w-[70ch]">{m.imports_mapping_intro()}</p>
            </div>

            {/* `Table` brings its own `overflow-x-auto` wrapper, so a wide file
                scrolls inside this card rather than widening the page; a second
                wrapper here would nest two scrollers. A file with no sample rows
                gets no table — a header row alone shows nothing to tell apart. */}
            {inspection.sampleRows.length > 0 && (
                <div className="rounded-ih-card border border-ih-border">
                    <Table<Record<string, string>>
                        columns={inspection.columns.map((c, i) => ({
                            key: `col-${i}`,
                            label: c,
                            cell: (row) => row[c] ?? "",
                        }))}
                        rows={inspection.sampleRows}
                        getRowKey={(_row, i) => i}
                    />
                </div>
            )}

            {draft.kind === "contacts" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                    <Select
                        label={m.imports_mapping_name()} options={columnOptions} disabled={busy}
                        value={draft.mapping.name}
                        onChange={(e) => setContact({ name: e.currentTarget.value })}
                    />
                    <Select
                        label={m.imports_mapping_email()} options={columnOptions} disabled={busy}
                        value={draft.mapping.email ?? NOT_IN_FILE}
                        onChange={(e) => setContact({ email: e.currentTarget.value })}
                    />
                    <Select
                        label={m.imports_mapping_phone()} options={columnOptions} disabled={busy}
                        value={draft.mapping.phone ?? NOT_IN_FILE}
                        onChange={(e) => setContact({ phone: e.currentTarget.value })}
                    />
                    <Select
                        label={m.imports_mapping_agency()} options={columnOptions} disabled={busy}
                        value={draft.mapping.agency ?? NOT_IN_FILE}
                        onChange={(e) => setContact({ agency: e.currentTarget.value })}
                    />
                    <Select
                        label={m.imports_mapping_notes()} options={columnOptions} disabled={busy}
                        value={draft.mapping.notes ?? NOT_IN_FILE}
                        onChange={(e) => setContact({ notes: e.currentTarget.value })}
                    />
                    <SourceSelect
                        label={m.imports_mapping_type()}
                        columns={inspection.columns}
                        values={IMPORT_CONTACT_TYPES}
                        valueLabel={(v) => (CONTACT_TYPE_LABEL[v] ?? (() => v))()}
                        source={draft.mapping.type}
                        busy={busy}
                        onChange={(type) => setContact({ type })}
                    />
                </div>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                    <Select
                        label={m.imports_mapping_email()} options={columnOptions} disabled={busy}
                        value={draft.mapping.email}
                        onChange={(e) => setMember({ email: e.currentTarget.value })}
                    />
                    <Select
                        label={m.imports_mapping_name()} options={columnOptions} disabled={busy}
                        value={draft.mapping.name ?? NOT_IN_FILE}
                        onChange={(e) => setMember({ name: e.currentTarget.value })}
                    />
                    <SourceSelect
                        label={m.imports_mapping_role()}
                        columns={inspection.columns}
                        values={IMPORT_MEMBER_ROLES}
                        valueLabel={(v) => (MEMBER_ROLE_LABEL[v] ?? (() => v))()}
                        source={draft.mapping.role}
                        busy={busy}
                        onChange={(role) => setMember({ role })}
                    />
                </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
                <Button
                    variant="primary"
                    disabled={busy || missing !== null}
                    onClick={() => { if (!missing) onApply(cleaned(draft)); }}
                >
                    {m.imports_mapping_save()}
                </Button>
                {/* Rendered only when it has something to say — an always-present
                    line is a layout jump, and one reading "Ready" is a second
                    thing to keep true. */}
                {missing && <p className="text-[12px] text-ih-fg-2">{missing}</p>}
            </div>
        </Card>
    );
}

/**
 * A field whose answer may be one value for the whole file OR a column of it.
 *
 * Two option groups in one control, labelled by which kind of answer they are.
 * The guess already produces both shapes — a members file with a `Role` header
 * is mapped column-wise while a contacts file always gets a fixed type — so a
 * control that could express only one of them would quietly replace the other
 * the first time it was touched.
 */
function SourceSelect<T extends string>({
    label,
    columns,
    values,
    valueLabel,
    source,
    busy,
    onChange,
}: {
    label: string;
    columns: string[];
    values: readonly T[];
    valueLabel: (value: T) => string;
    source: ValueSource<T>;
    busy: boolean;
    onChange: (source: ValueSource<T>) => void;
}) {
    return (
        <Select
            label={label}
            disabled={busy}
            value={encodeSource(source)}
            onChange={(e) => onChange(decodeSource(e.currentTarget.value, values, source))}
        >
            <optgroup label={m.imports_mapping_fixed_for_all()}>
                {values.map((v) => (
                    <option key={v} value={`fixed:${v}`}>{valueLabel(v)}</option>
                ))}
            </optgroup>
            {columns.length > 0 && (
                <optgroup label={m.imports_mapping_from_a_column()}>
                    {columns.map((c) => (
                        <option key={c} value={`column:${c}`}>{c}</option>
                    ))}
                </optgroup>
            )}
        </Select>
    );
}
