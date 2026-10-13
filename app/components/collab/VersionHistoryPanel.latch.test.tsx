// @vitest-environment happy-dom
/**
 * VersionHistoryPanel same-frame latch: "Save version now" and the restore confirmation each write a
 * version row on the server (a manual capture; a restore also captures the pre-restore state), so two
 * clicks dispatched in ONE frame must reach fetch once. The pending state only lands after a render,
 * which is too late for the second click.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";

vi.mock("~/hooks/useSessionContext", () => ({
    useDisplayTimeZone: () => "UTC",
    useInspectionDateTimeFormat: () => ({ locale: "en-US", dateFormat: "us", timeFormat: "12h" }),
}));

import { VersionHistoryPanel } from "~/components/collab/VersionHistoryPanel";

const SNAPSHOTS = [{ seq: 2, atMs: Date.now() - 60_000, byUserId: "user-abc" }];
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const button = (re: RegExp) =>
    (Array.from(document.body.querySelectorAll("button")) as HTMLButtonElement[]).find((b) => re.test(b.textContent ?? ""))!;
const writes = (fetchMock: ReturnType<typeof vi.fn>, suffix: string) =>
    fetchMock.mock.calls.filter((c) => String(c[0]).endsWith(suffix) && (c[1] as RequestInit | undefined)?.method === "POST");

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
    fetchMock = vi.fn(async () => json(SNAPSHOTS));
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

async function mount() {
    render(<VersionHistoryPanel open onClose={vi.fn()} inspectionId="insp-1" />);
    await settle();
}

describe("VersionHistoryPanel latch", () => {
    it("captures ONE version for two same-frame clicks on Save version now", async () => {
        await mount();
        const save = button(/save version now/i);
        act(() => { save.click(); save.click(); });
        await settle();
        expect(writes(fetchMock, "/collab/snapshots")).toHaveLength(1);
    });

    it("CONTROL - a later click on Save version now goes through", async () => {
        await mount();
        act(() => { button(/save version now/i).click(); });
        await settle();
        act(() => { button(/save version now/i).click(); });
        await settle();
        expect(writes(fetchMock, "/collab/snapshots")).toHaveLength(2);
    });

    it("restores ONCE for two same-frame clicks on the confirm button", async () => {
        await mount();
        act(() => { button(/^restore$/i).click(); });
        await settle();
        const confirm = button(/restore version/i);
        act(() => { confirm.click(); confirm.click(); });
        await settle();
        expect(writes(fetchMock, "/collab/restore")).toHaveLength(1);
    });
});
