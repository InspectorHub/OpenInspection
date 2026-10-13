// @vitest-environment happy-dom
/**
 * Adding a contractor type twice would insert a duplicate row. The submit handler validates and then
 * clears the field, but that state is not committed until render, so a same-frame second submit
 * would still carry the name. Two submits in one frame must reach the action once; an INVALID
 * (empty) first submit must not leave the latch closed.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act, waitFor, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import SettingsContractorTypes from "./settings-contractor-types";
import { m } from "~/paraglide/messages";

afterEach(cleanup);

function mount() {
    const names: string[] = [];
    let release: () => void = () => {};
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: SettingsContractorTypes,
            loader: () => ({ types: [] }),
            action: async ({ request }) => {
                const form = await request.formData();
                names.push(String(form.get("name")));
                await new Promise<void>((resolve) => { release = resolve; });
                return { ok: false, intent: "create" };
            },
        },
    ]);
    const view = render(<Stub initialEntries={["/"]} />);
    return { ...view, names, release: () => release() };
}

async function parts(container: HTMLElement) {
    return waitFor(() => {
        const input = container.querySelector<HTMLInputElement>('input[name="name"]');
        expect(input).not.toBeNull();
        return { input: input!, form: input!.form! };
    });
}

describe("settings-contractor-types create", () => {
    it("creates the type once for a double submit, and again after it settles", async () => {
        const { container, names, release } = mount();
        const { input, form } = await parts(container);
        fireEvent.change(input, { target: { value: "Roofer" } });
        act(() => { form.requestSubmit(); form.requestSubmit(); });
        await waitFor(() => expect(names).toEqual(["Roofer"]));
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(names).toEqual(["Roofer"]);
        await act(async () => { release(); });
        await waitFor(() => expect(input.value).toBe(""));
        fireEvent.change(input, { target: { value: "Plumber" } });
        act(() => { form.requestSubmit(); });
        await waitFor(() => expect(names).toEqual(["Roofer", "Plumber"]));
        await act(async () => { release(); });
    });

    it("an invalid empty submit does not close the latch", async () => {
        const { container, names, release } = mount();
        const { input, form } = await parts(container);
        act(() => { form.requestSubmit(); });
        expect(names).toEqual([]);
        fireEvent.change(input, { target: { value: "Roofer" } });
        act(() => { form.requestSubmit(); });
        await waitFor(() => expect(names).toEqual(["Roofer"]));
        await act(async () => { release(); });
    });
});

describe("settings-contractor-types rename", () => {
    function mountRename() {
        const calls: string[] = [];
        const Stub = createRoutesStub([
            {
                path: "/",
                Component: SettingsContractorTypes,
                loader: () => ({ types: [{ id: "t1", name: "Roofer", sortOrder: 0 }] }),
                action: async ({ request }) => {
                    const form = await request.formData();
                    calls.push(String(form.get("intent")));
                    return { ok: true, intent: "rename" };
                },
            },
        ]);
        const view = render(<Stub initialEntries={["/"]} />);
        return { ...view, calls };
    }
    async function openRename(container: HTMLElement) {
        const btn = await waitFor(() => {
            const b = Array.from(container.querySelectorAll("button")).find((x) => x.textContent === m.settings_contractor_types_rename());
            expect(b).toBeDefined();
            return b!;
        });
        act(() => { btn.click(); });
        return await waitFor(() => {
            const input = container.querySelector<HTMLInputElement>('input[type="hidden"][value="rename"]');
            expect(input).not.toBeNull();
            return input!.form!;
        });
    }

    it("renames once for a double submit, and again after it settles", async () => {
        const { container, calls } = mountRename();
        const form = await openRename(container);
        act(() => { form.requestSubmit(); form.requestSubmit(); });
        await waitFor(() => expect(calls).toEqual(["rename"]));
        await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
        expect(calls).toEqual(["rename"]);

        const again = await openRename(container);
        act(() => { again.requestSubmit(); });
        await waitFor(() => expect(calls).toEqual(["rename", "rename"]));
    });
});

