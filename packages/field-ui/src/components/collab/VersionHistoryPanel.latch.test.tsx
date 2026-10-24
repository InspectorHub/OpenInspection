// @vitest-environment happy-dom
/**
 * VersionHistoryPanel same-frame latch: "Save version now" and the restore confirmation each write a
 * version row on the server (a manual capture; a restore also captures the pre-restore state), so two
 * clicks dispatched in ONE frame must reach the data source once. The pending state only lands after a
 * render, which is too late for the second click.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import { createEmptyEditorData, createFakeDataSource, createFakeVersionHistory } from "../../testing/fake-data-source";
import type { FakeVersionHistory } from "../../testing/fake-data-source";
import { VersionHistoryPanel } from "./VersionHistoryPanel";

const SNAPSHOTS = [{ seq: 2, atMs: Date.now() - 60_000, byUserId: "user-abc" }];
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const button = (re: RegExp) =>
    (Array.from(document.body.querySelectorAll("button")) as HTMLButtonElement[]).find((b) => re.test(b.textContent ?? ""))!;

afterEach(cleanup);

async function mount(): Promise<FakeVersionHistory> {
    const versionHistory = createFakeVersionHistory(SNAPSHOTS);
    const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { versionHistory } });
    render(
        <FieldDataSourceProvider dataSource={fake}>
            <VersionHistoryPanel open onClose={vi.fn()} inspectionId="insp-1" />
        </FieldDataSourceProvider>,
    );
    await settle();
    return versionHistory;
}

describe("VersionHistoryPanel latch", () => {
    it("captures ONE version for two same-frame clicks on Save version now", async () => {
        const vh = await mount();
        const save = button(/save version now/i);
        act(() => { save.click(); save.click(); });
        await settle();
        expect(vh.captures).toHaveLength(1);
    });

    it("CONTROL - a later click on Save version now goes through", async () => {
        const vh = await mount();
        act(() => { button(/save version now/i).click(); });
        await settle();
        act(() => { button(/save version now/i).click(); });
        await settle();
        expect(vh.captures).toHaveLength(2);
    });

    it("restores ONCE for two same-frame clicks on the confirm button", async () => {
        const vh = await mount();
        act(() => { button(/^restore$/i).click(); });
        await settle();
        const confirm = button(/restore version/i);
        act(() => { confirm.click(); confirm.click(); });
        await settle();
        expect(vh.restores).toEqual([{ inspectionId: "insp-1", seq: 2 }]);
    });

    it("CONTROL - a restore pressed again after the first settled and failed goes through", async () => {
        const vh = await mount();
        vh.failRestore("no");
        act(() => { button(/^restore$/i).click(); });
        await settle();
        act(() => { button(/restore version/i).click(); });
        await settle();
        act(() => { button(/restore version/i).click(); });
        await settle();
        expect(vh.restores).toHaveLength(2);
    });
});
