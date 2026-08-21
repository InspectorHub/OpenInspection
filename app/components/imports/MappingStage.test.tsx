// @vitest-environment happy-dom
/**
 * Which of your columns holds what.
 *
 * This screen did not exist. The endpoint's own summary said it did ("for the
 * contact-import mapping UI"), and the modal it replaces had a preview step —
 * but that step only printed the row count and the column names, and nothing on
 * it could be changed. The mapping was guessed, and when the guess failed it
 * fell back to the first column for the name, so a file whose first column was
 * an email address imported an email address as everybody's name.
 *
 * Every assertion below therefore either COMPARES two mappings differing in one
 * property, or watches what the form HANDS BACK change when a control is
 * touched. "A select renders" is true of a form with no rules at all.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { asSelect } from "../../../tests/helpers/dom";
import { MappingStage } from "./MappingStage";
import type { ColumnMapping } from "~/lib/imports-types";

afterEach(cleanup);

const INSPECTION = {
    columns: ["Alpha", "Beta", "Gamma"],
    sampleRows: [
        { Alpha: "a1", Beta: "b1", Gamma: "c1" },
        { Alpha: "a2", Beta: "b2", Gamma: "c2" },
    ],
};

function renderStage(mapping: ColumnMapping, busy = false) {
    const onApply = vi.fn();
    render(
        <MappingStage inspection={INSPECTION} mapping={mapping} busy={busy} onApply={onApply} />,
    );
    return { onApply };
}

/** A contact mapping whose name column was guessed and whose type was not. */
function contacts(): ColumnMapping {
    return { kind: "contacts", mapping: { name: "Alpha", type: { fixed: "client" } } };
}

function save(): HTMLButtonElement {
    return screen.getByRole<HTMLButtonElement>("button", { name: "Use these columns" });
}

describe("MappingStage: the file in front of the question", () => {
    it("shows a sample of the file, so the columns can be told apart", () => {
        renderStage(contacts());
        expect(screen.getByText("a1")).toBeTruthy();
        expect(screen.getByText("b1")).toBeTruthy();
        expect(screen.getByText("c2")).toBeTruthy();
    });

    it("offers every column of the file as an answer, and nothing else", () => {
        renderStage(contacts());
        const email = asSelect(screen.getByLabelText("Email"), "the email column select");
        expect([...email.options].map((o) => o.value))
            .toEqual(["", "Alpha", "Beta", "Gamma"]);
    });
});

describe("MappingStage: an unanswered question looks unanswered", () => {
    it("leaves an unguessed name column empty rather than filling it with the first one", () => {
        renderStage({ kind: "contacts", mapping: { name: "", type: { fixed: "client" } } });
        expect(asSelect(screen.getByLabelText("Name")).value).toBe("");
    });

    it("shows the guess when there was one, which is the control on the line above", () => {
        renderStage(contacts());
        expect(asSelect(screen.getByLabelText("Name")).value).toBe("Alpha");
    });

    it("refuses to send an unanswered required column, and says which one", () => {
        const { onApply } = renderStage({
            kind: "contacts",
            mapping: { name: "", type: { fixed: "client" } },
        });
        expect(save().disabled).toBe(true);
        fireEvent.click(save());
        expect(onApply).not.toHaveBeenCalled();
        expect(screen.getByText("Choose which column holds the name.")).toBeTruthy();
    });

    it("lets it through once it is answered, and stops saying why", () => {
        // The positive control. A button disabled on every render is not a rule,
        // and a sentence printed on every render is not a reason.
        const { onApply } = renderStage({
            kind: "contacts",
            mapping: { name: "", type: { fixed: "client" } },
        });
        fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Beta" } });
        expect(save().disabled).toBe(false);
        expect(screen.queryByText("Choose which column holds the name.")).toBeNull();
        fireEvent.click(save());
        expect(onApply).toHaveBeenCalledWith({
            kind: "contacts",
            mapping: { name: "Beta", type: { fixed: "client" } },
        });
    });

    it("names the required column the OTHER family is missing, not the contact one", () => {
        // Members are keyed by the address the invitation goes to. A single
        // "choose the name column" sentence would be a true-sounding lie here.
        renderStage({ kind: "members", mapping: { email: "", role: { fixed: "inspector" } } });
        expect(screen.getByText("Choose which column holds the email address.")).toBeTruthy();
        expect(screen.queryByText("Choose which column holds the name.")).toBeNull();
    });
});

describe("MappingStage: an optional field left blank", () => {
    it("offers 'not in this file' as a real answer rather than an empty slot", () => {
        renderStage(contacts());
        const email = asSelect(screen.getByLabelText("Email"), "the email column select");
        expect(email.value).toBe("");
        expect([...email.options].some((o) => o.textContent === "Not in this file")).toBe(true);
    });

    it("drops the field rather than sending an empty column name", () => {
        // "" is not a column. Sending it asks the adapter to find one, and the
        // answer is a refusal naming a column the operator never chose.
        const { onApply } = renderStage({
            kind: "contacts",
            mapping: { name: "Alpha", email: "Beta", type: { fixed: "client" } },
        });
        fireEvent.change(screen.getByLabelText("Email"), { target: { value: "" } });
        fireEvent.click(save());
        expect(onApply).toHaveBeenCalledWith({
            kind: "contacts",
            mapping: { name: "Alpha", type: { fixed: "client" } },
        });
    });

    it("keeps it when it was answered, which is the control on the line above", () => {
        const { onApply } = renderStage({
            kind: "contacts",
            mapping: { name: "Alpha", email: "Beta", type: { fixed: "client" } },
        });
        fireEvent.click(save());
        expect(onApply).toHaveBeenCalledWith({
            kind: "contacts",
            mapping: { name: "Alpha", email: "Beta", type: { fixed: "client" } },
        });
    });
});

describe("MappingStage: the answer the file does not contain", () => {
    it("asks the contact type as a question rather than defaulting silently", () => {
        // Every contact imported through the path this replaces got the schema
        // default, because nothing inferred one and nothing asked.
        renderStage(contacts());
        expect(screen.getByLabelText("Contact type")).toBeTruthy();
    });

    it("sends one answer for the whole file when that is what was chosen", () => {
        const { onApply } = renderStage(contacts());
        fireEvent.change(screen.getByLabelText("Contact type"), { target: { value: "fixed:agent" } });
        fireEvent.click(save());
        expect(onApply).toHaveBeenCalledWith({
            kind: "contacts",
            mapping: { name: "Alpha", type: { fixed: "agent" } },
        });
    });

    it("offers the file's columns for it too, and sends a column when one is chosen", () => {
        const { onApply } = renderStage(contacts());
        fireEvent.change(screen.getByLabelText("Contact type"), { target: { value: "column:Gamma" } });
        fireEvent.click(save());
        expect(onApply).toHaveBeenCalledWith({
            kind: "contacts",
            mapping: { name: "Alpha", type: { column: "Gamma" } },
        });
    });

    it("keeps a role that already comes from a column instead of overwriting it", () => {
        // The guess DOES produce this: a members file with a `Role` header is
        // mapped column-wise, and a control that could only express "one answer
        // for everyone" would replace it with a fixed role on first touch —
        // silently importing everybody as an inspector.
        const { onApply } = renderStage({
            kind: "members",
            mapping: { email: "Alpha", role: { column: "Gamma" } },
        });
        expect(asSelect(screen.getByLabelText("Team role")).value).toBe("column:Gamma");
        fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Beta" } });
        fireEvent.click(save());
        expect(onApply).toHaveBeenCalledWith({
            kind: "members",
            mapping: { email: "Alpha", name: "Beta", role: { column: "Gamma" } },
        });
    });
});

describe("MappingStage: while a submit is in flight", () => {
    it("disables the controls as well as the button", () => {
        renderStage(contacts(), true);
        expect(save().disabled).toBe(true);
        expect(asSelect(screen.getByLabelText("Name")).disabled).toBe(true);
    });
});
