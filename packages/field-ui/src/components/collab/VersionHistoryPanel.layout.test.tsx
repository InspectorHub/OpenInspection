// @vitest-environment happy-dom
/**
 * On an iPhone the "Save version now" button was squeezed beside the description until its label wrapped to three lines inside a fixed
 * height, and the text was cut off top and bottom. The button now keeps its label on one line and its own width, and the row wraps instead.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import { createEmptyEditorData, createFakeDataSource, createFakeVersionHistory } from "../../testing/fake-data-source";
import { VersionHistoryPanel } from "./VersionHistoryPanel";

afterEach(cleanup);

describe("VersionHistoryPanel save button layout", () => {
    it("keeps the label on one line and its width, in a row that wraps, and is at least 44px on a touch screen", async () => {
        const versionHistory = createFakeVersionHistory([{ seq: 2, atMs: Date.now() - 60_000, byUserId: "user-abc" }]);
        const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { versionHistory } });
        render(
            <FieldDataSourceProvider dataSource={fake}>
                <VersionHistoryPanel open onClose={vi.fn()} inspectionId="insp-1" />
            </FieldDataSourceProvider>,
        );
        await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
        const save = (Array.from(document.body.querySelectorAll("button")) as HTMLButtonElement[]).find((b) => /save version now/i.test(b.textContent ?? ""))!;
        expect(save.className).toContain("whitespace-nowrap");
        expect(save.className).toContain("shrink-0");
        expect(save.className).toContain("pointer-coarse:min-h-11");
        expect(save.className).not.toMatch(/(^|\s)h-9(\s|$)/);
        expect(save.parentElement?.className).toContain("flex-wrap");
    });
});
