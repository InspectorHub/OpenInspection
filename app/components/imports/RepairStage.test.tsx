// @vitest-environment happy-dom
/**
 * The entries somebody fixes over two sittings.
 *
 * One field at a time, because the server reports the FIRST thing wrong with an
 * entry reading down it — an edit box per reported field is what makes this a
 * fill-in-the-blank rather than a JSON syntax exercise.
 *
 * What is SENT is the whole entry with that one field replaced: the repair
 * endpoint rewrites the payload wholesale, so a patch alone would erase every
 * other field. Both halves of that are asserted, because the shape of the
 * request is invisible on screen and a component that sent only the edited field
 * would look identical.
 *
 * Paging is asserted by what RENDERS, not by whether the component re-rendered:
 * a page control wired to nothing looks exactly like a working one.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { RepairStage } from "./RepairStage";
import type { ProblemRow } from "~/lib/imports-types";

afterEach(cleanup);

const ROWS: ProblemRow[] = [
    {
        rowId: "r1",
        entity: "contact",
        position: 0,
        field: "name",
        reason: "This entry has no name. Every contact needs one — map a column to it, or type one in.",
        payloadEcho: { name: "", email: "a@example.test", type: "client" },
    },
    {
        rowId: "r2",
        entity: "contact",
        position: 3,
        field: "type",
        reason: "A contact has to be one of agent, client, other.",
        value: "vendor",
        suggestion: "client",
        payloadEcho: { name: "Bob", email: "b@example.test", type: "vendor" },
    },
];

type Props = React.ComponentProps<typeof RepairStage>;

function renderStage(over: Partial<Props> = {}) {
    const onSave = vi.fn();
    const onPage = vi.fn();
    const onPageSize = vi.fn();
    const result = render(
        <RepairStage
            rows={ROWS}
            total={2}
            page={1}
            pageSize={25}
            busy={false}
            onSave={onSave}
            onPage={onPage}
            onPageSize={onPageSize}
            {...over}
        />,
    );
    return { onSave, onPage, onPageSize, ...result };
}

describe("RepairStage: what is wrong", () => {
    it("says it in the words the server used, rather than a category of its own", () => {
        renderStage();
        expect(screen.getByText(/This entry has no name/)).toBeTruthy();
        expect(screen.getByText(/one of agent, client, other/)).toBeTruthy();
    });

    it("points at the entry by its place in the operator's own file, counting from one", () => {
        renderStage();
        // `position` is the index within its own family. On screen it is
        // one-based, so "the fourth contact" is something they can count to in
        // a spreadsheet rather than an array index they have to translate.
        expect(screen.getByText("Contact 4")).toBeTruthy();
        expect(screen.getByText("Contact 1")).toBeTruthy();
    });

    it("says how many are behind the page, because a page of two is unreadable alone", () => {
        renderStage({ total: 47, page: 2 });
        expect(screen.getByText("Entries still needing you: 47.")).toBeTruthy();
    });
});

describe("RepairStage: saving one field", () => {
    it("sends the whole entry back with only that field replaced", () => {
        const { onSave } = renderStage();
        fireEvent.change(screen.getByLabelText("Contact 1 name"), { target: { value: "Alice Ng" } });
        fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
        expect(onSave).toHaveBeenCalledWith("r1", {
            name: "Alice Ng",
            email: "a@example.test",
            type: "client",
        });
    });

    it("starts from what the entry holds rather than an empty box", () => {
        renderStage();
        expect(screen.getByLabelText<HTMLInputElement>("Contact 4 type").value).toBe("vendor");
    });

    it("has nothing to save until something changes", () => {
        const { onSave } = renderStage();
        const save = screen.getAllByRole<HTMLButtonElement>("button", { name: "Save" })[1];
        expect(save.disabled).toBe(true);
        fireEvent.change(screen.getByLabelText("Contact 4 type"), { target: { value: "agent" } });
        expect((screen.getAllByRole<HTMLButtonElement>("button", { name: "Save" })[1]).disabled)
            .toBe(false);
        fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]);
        expect(onSave).toHaveBeenCalledWith("r2", {
            name: "Bob",
            email: "b@example.test",
            type: "agent",
        });
    });

    it("removes an emptied field instead of storing a blank in it", () => {
        // "Correct it, or clear it — a contact without one is fine" is the
        // server's own sentence for a malformed address. Storing "" would keep
        // the entry unwritable while looking as though it had been answered.
        const { onSave } = renderStage({
            rows: [{
                rowId: "r3",
                entity: "contact",
                position: 1,
                field: "email",
                reason: "This does not look like an email address.",
                value: "nope",
                payloadEcho: { name: "Cara", email: "nope", type: "client" },
            }],
            total: 1,
        });
        fireEvent.change(screen.getByLabelText("Contact 2 email"), { target: { value: "  " } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        expect(onSave).toHaveBeenCalledWith("r3", { name: "Cara", type: "client" });
    });

    it("offers a suggestion as something to accept, never as something applied", () => {
        // Applying it silently is how the path this replaces imported an email
        // address as everybody's name.
        const { onSave } = renderStage();
        expect(screen.getByLabelText<HTMLInputElement>("Contact 4 type").value).toBe("vendor");
        fireEvent.click(screen.getByRole("button", { name: "Use client" }));
        expect(onSave).toHaveBeenCalledWith("r2", {
            name: "Bob",
            email: "b@example.test",
            type: "client",
        });
    });

    it("offers no suggestion for an entry the server made none for", () => {
        renderStage();
        expect(screen.getAllByRole("button", { name: /^Use / })).toHaveLength(1);
    });
});

describe("RepairStage: an entry no text box can fix", () => {
    it("says so instead of offering a box that would overwrite the field with a string", () => {
        // A template with no sections is the one problem an upload can actually
        // produce, and its faulty field is the schema OBJECT. Typing into it
        // would replace a whole inspection form with the characters typed, and
        // the repair endpoint stores what it is given without re-validating.
        renderStage({
            rows: [{
                rowId: "r4",
                entity: "template",
                position: 0,
                field: "schema",
                reason: "This template has no sections, so importing it would create an inspection form with nothing on it.",
                payloadEcho: { name: "Empty", schema: { schemaVersion: 2, sections: [] } },
            }],
            total: 1,
        });
        expect(screen.queryByRole("textbox")).toBeNull();
        expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
        expect(screen.getByText("This entry cannot be corrected here. Discard the import and fix the file.")).toBeTruthy();
    });

    it("offers the box for an entry that differs only in the kind of field at fault", () => {
        // The positive control: a component that never rendered a box passes
        // the assertion above.
        renderStage({
            rows: [{
                rowId: "r5",
                entity: "template",
                position: 0,
                field: "name",
                reason: "This template has no name.",
                payloadEcho: { name: "", schema: { schemaVersion: 2, sections: [{ id: "s" }] } },
            }],
            total: 1,
        });
        expect(screen.getByRole("textbox")).toBeTruthy();
        expect(screen.queryByText(/cannot be corrected here/)).toBeNull();
    });
});

describe("RepairStage: paging", () => {
    it("asks for the page that was clicked", () => {
        const { onPage } = renderStage({ total: 47, page: 1 });
        fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
        expect(onPage).toHaveBeenCalledWith(2);
    });

    it("renders the rows it was given for that page, not the ones before it", () => {
        // The half a callback assertion cannot reach: a control that fires the
        // callback and renders the same rows is indistinguishable from a working
        // one until the second page arrives.
        const { rerender, onPage, onPageSize } = renderStage({ total: 47, page: 1 });
        expect(screen.getByText("Contact 1")).toBeTruthy();

        rerender(
            <RepairStage
                rows={[{
                    rowId: "r9",
                    entity: "contact",
                    position: 30,
                    field: "name",
                    reason: "This entry has no name.",
                    payloadEcho: { name: "", type: "client" },
                }]}
                total={47}
                page={2}
                pageSize={25}
                busy={false}
                onSave={vi.fn()}
                onPage={onPage}
                onPageSize={onPageSize}
            />,
        );
        expect(screen.getByText("Contact 31")).toBeTruthy();
        expect(screen.queryByText("Contact 1")).toBeNull();
    });

    it("changes the page size for real rather than showing a control that does nothing", () => {
        const { onPageSize } = renderStage({ total: 47, page: 1 });
        fireEvent.change(screen.getByLabelText("Items per page"), { target: { value: "50" } });
        expect(onPageSize).toHaveBeenCalledWith(50);
    });
});
