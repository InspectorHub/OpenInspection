// @vitest-environment happy-dom
/**
 * The statutory details panel with the write it makes: a `save-statutory-details` command carrying the
 * WHOLE set on every blur, issued through the host's own guard. Two blurs a few milliseconds apart (leave
 * one field, immediately leave the next) arrive before any render could show a busy state; the second must
 * be dropped, and the whole-set payload of the one that lands carries every answer anyway.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CommandResult } from "../../commands";
import { FieldDataSourceProvider } from "../../context";
import type { StatutoryDetailsValues } from "./StatutoryDetailsPanel";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import type { FakeDataSource } from "../../testing/fake-data-source";
import { StatutoryDetailsHost } from "./StatutoryDetailsHost";

afterEach(cleanup);

const DETAILS: StatutoryDetailsValues = {
    inspectorSignatureDate: null,
    employeePrintedName: "Pat",
    ownerName: null,
    ownerEmail: null,
    ownerMailingAddress: null,
    ownerHomePhone: null,
    ownerWorkPhone: null,
    ownerCellPhone: null,
};

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

function mount(details: StatutoryDetailsValues | null = DETAILS) {
    const fake: FakeDataSource = createFakeDataSource({ data: createEmptyEditorData() });
    const utils = render(
        <FieldDataSourceProvider dataSource={fake}>
            <StatutoryDetailsHost inspectionId="insp-1" details={details} />
        </FieldDataSourceProvider>,
    );
    return { fake, ...utils };
}

describe("StatutoryDetailsHost", () => {
    it("renders nothing at all when there is no such panel (null is not an empty panel)", () => {
        const { fake } = mount(null);
        expect(document.querySelector("[data-testid='statutory-details-panel']")).toBeNull();
        expect(fake.commands).toEqual([]);
    });

    it("issues save-statutory-details with the WHOLE set on blur", async () => {
        const { fake } = mount();
        const owner = screen.getByLabelText(/^owner name/i);
        fireEvent.change(owner, { target: { value: "Sam Owner" } });
        fireEvent.blur(owner);
        await waitFor(() => expect(fake.commands).toHaveLength(1));
        expect(fake.commands[0]).toMatchObject({
            inspectionId: "insp-1",
            cmd: { type: "save-statutory-details", payload: { ...DETAILS, ownerName: "Sam Owner" } },
        });
    });

    it("drops the second of two same-frame blurs: ONE command, the first", async () => {
        const { fake } = mount();
        const owner = screen.getByLabelText(/^owner name/i);
        const email = screen.getByLabelText(/^owner email/i);
        fireEvent.change(owner, { target: { value: "Sam" } });
        fireEvent.change(email, { target: { value: "sam@example.com" } });
        act(() => {
            owner.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
            email.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        });
        await settle();
        expect(fake.commands).toHaveLength(1);
    });

    it("CONTROL - a later blur goes through once the first has settled, carrying every answer so far", async () => {
        const { fake } = mount();
        const owner = screen.getByLabelText(/^owner name/i);
        fireEvent.change(owner, { target: { value: "Sam" } });
        fireEvent.blur(owner);
        await settle();
        const email = screen.getByLabelText(/^owner email/i);
        fireEvent.change(email, { target: { value: "sam@example.com" } });
        fireEvent.blur(email);
        await settle();
        expect(fake.commands).toHaveLength(2);
        expect(fake.commands[1]!.cmd).toMatchObject({ payload: { ownerName: "Sam", ownerEmail: "sam@example.com" } });
    });

    it("disables the inputs while a write is out and frees them when it answers", async () => {
        const { fake } = mount();
        let answer: (r: CommandResult<undefined>) => void = () => undefined;
        vi.spyOn(fake, "execute").mockImplementation((() =>
            new Promise<CommandResult<undefined>>((resolve) => { answer = resolve; })) as FakeDataSource["execute"]);
        const owner = screen.getByLabelText(/^owner name/i);
        fireEvent.change(owner, { target: { value: "Sam" } });
        fireEvent.blur(owner);
        await waitFor(() => expect(owner).toBeDisabled());
        answer({ ok: true });
        await waitFor(() => expect(owner).not.toBeDisabled());
    });
});
