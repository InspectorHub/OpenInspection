// @vitest-environment happy-dom
/**
 * The offline access limit is the retention-window control with a "days" unit:
 * it renders, posts the typed number under its own intent, and shows the
 * action's validation message for 0 and 366.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";

const patchTenantConfig = vi.fn();
vi.mock("~/lib/session.server", () => ({ requireToken: vi.fn(async () => "tok") }));
vi.mock("~/lib/access.server", () => ({ requireAdminLoader: vi.fn(async () => ({ forbidden: false, token: "tok" })) }));
vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({ admin: { "tenant-config": { $patch: patchTenantConfig } } })),
}));

import { action } from "~/routes/settings-compliance";
import { RetentionWindowSection } from "./RetentionWindowSection";

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });
afterEach(cleanup);

function mount() {
    patchTenantConfig.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response);
    const Stub = createRoutesStub([{
        path: "/",
        action: action as never,
        Component: () => (
            <RetentionWindowSection
                heading="Offline access" description="d" initialYears={30} min={1} max={365}
                intent="offline-save" field="offlineMaxDays" unitLabel="Offline access limit (days)"
            />
        ),
    }]);
    return render(<Stub initialEntries={["/"]} />);
}

async function saveWith(container: HTMLElement, value: string) {
    const input = container.querySelector<HTMLInputElement>("input[type=number]")!;
    fireEvent.change(input, { target: { value } });
    await act(async () => { container.querySelector<HTMLButtonElement>("button")!.click(); });
    await settle();
}

describe("offline access limit section", () => {
    it("renders the days input with the stored value and no note paragraph", async () => {
        const { container, getByText } = mount();
        await settle();
        expect(getByText("Offline access limit (days)")).toBeTruthy();
        expect(container.querySelector<HTMLInputElement>("input[type=number]")!.value).toBe("30");
        expect(container.querySelectorAll("p")).toHaveLength(1);
    });

    it("posts offlineMaxDays for a valid value", async () => {
        const { container, findByText } = mount();
        await settle();
        await saveWith(container, "45");
        expect(patchTenantConfig).toHaveBeenCalledWith({ json: { offlineMaxDays: 45 } });
        expect(await findByText("Saved.")).toBeTruthy();
    });

    it.each(["0", "366"])("shows a validation error for %s and does not save", async (bad) => {
        const { container } = mount();
        await settle();
        await saveWith(container, bad);
        expect(patchTenantConfig).not.toHaveBeenCalled();
        expect(container.textContent).toContain("between 1 and 365");
    });
});
