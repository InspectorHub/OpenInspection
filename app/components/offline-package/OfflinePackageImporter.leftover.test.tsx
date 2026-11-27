// @vitest-environment happy-dom
/**
 * The leftovers of an import survive a reload (#485): the import page holds
 * the original file only in memory, so a reload used to lose the held-back
 * download at the moment the inspector needed it. The extracted held-back
 * package is kept in a slot, and the choose screen offers it again.
 *
 * The slot is a memory store here — happy-dom has no `indexedDB`. The
 * IndexedDB store itself degrades to a no-op without storage, asserted below.
 * Harness: `importer-test-kit`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { readPackageSummary } from "@core/offline-package";
import { ok, refused, renderPage, runToResult, three } from "~/components/offline-package/importer-test-kit";
import { indexedDbLeftoverStore, memoryLeftoverStore } from "~/lib/offline-package-leftovers";
import { engineReads } from "../../../tests/unit/helpers/offline-package-cases";

beforeEach(() => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** A run that leaves insp-1 behind and imports the other two. */
async function runWithHeldBack(store: ReturnType<typeof memoryLeftoverStore>) {
    return runToResult(three, (_n, b) => {
        const ids = readPackageSummary(b).manifest.inspections.map((i) => i.id);
        return ids.includes("insp-1") && ids.length === 3 ? refused(404, "NOT_FOUND", { inspectionId: "insp-1" }) : ok(b);
    }, store);
}

function captureBlobs() {
    const created: Blob[] = [];
    (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mockImplementation((blob: Blob) => {
        created.push(blob);
        return "blob:leftover";
    });
    return created;
}

describe("leftovers kept past a reload", () => {
    it("offers the left-behind package again after the page remounts, and downloads it as a valid package", async () => {
        const store = memoryLeftoverStore();
        await runWithHeldBack(store);
        expect(store.slot).not.toBeNull();
        expect(store.slot!.ids).toEqual(["insp-1"]);

        // A reload: the page remounts, the file is gone, the leftovers are still offered.
        cleanup();
        renderPage("tenant-1", store);
        const card = await screen.findByTestId("offline-package-leftover");
        expect(card.textContent).toContain("1 inspection from your last import was not imported.");

        const created = captureBlobs();
        await act(async () => {
            fireEvent.click(within(card).getByRole("button", { name: "Download left-behind package" }));
        });
        expect(created).toHaveLength(1);
        const verdict = engineReads(new Uint8Array(await created[0]!.arrayBuffer()));
        expect(verdict.ok).toBe(true);
        expect(verdict.ok && verdict.view.ids).toEqual(["insp-1"]);
        // It carries that inspection's own queued change, and not the others'.
        expect(verdict.ok && verdict.view.writes.get("insp-1")).toEqual(["k-update-insp-1-0"]);
        // Downloading does not clear the slot: the inspector may need it again.
        expect(store.slot).not.toBeNull();
    });

    it("discards the leftovers on request", async () => {
        const store = memoryLeftoverStore();
        await runWithHeldBack(store);
        cleanup();
        renderPage("tenant-1", store);
        const card = await screen.findByTestId("offline-package-leftover");
        await act(async () => {
            fireEvent.click(within(card).getByRole("button", { name: "Discard" }));
        });
        await waitFor(() => expect(screen.queryByTestId("offline-package-leftover")).toBeNull());
        expect(store.slot).toBeNull();
    });

    it("clears the slot when a later import leaves nothing behind", async () => {
        const store = memoryLeftoverStore();
        let offline = true;
        const { fetchMock } = await runToResult(three, (_n, b) => (offline ? "throw" : ok(b)), store);
        expect(store.slot).not.toBeNull();
        offline = false;
        const before = fetchMock.mock.calls.length;
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Import this file again" }));
        });
        await waitFor(() => expect(screen.queryByTestId("offline-package-held-back")).toBeNull());
        expect(fetchMock.mock.calls.length).toBe(before + 1);
        expect(store.slot).toBeNull();
        // And a reload after that clean import offers nothing.
        cleanup();
        renderPage("tenant-1", store);
        await waitFor(() => expect(document.querySelector('input[type="file"]')).toBeTruthy());
        expect(screen.queryByTestId("offline-package-leftover")).toBeNull();
    });

    it("does not offer another company's leftovers to this company", async () => {
        const store = memoryLeftoverStore();
        await runWithHeldBack(store);
        cleanup();
        renderPage("tenant-2", store);
        await waitFor(() => expect(document.querySelector('input[type="file"]')).toBeTruthy());
        expect(screen.queryByTestId("offline-package-leftover")).toBeNull();
    });
});

describe("the IndexedDB slot without storage", () => {
    it("does nothing when this browser has no IndexedDB", async () => {
        const store = indexedDbLeftoverStore();
        await expect(store.save({ bytes: new Uint8Array([1]), ids: ["a"], tenantId: "t", savedAt: 0 })).resolves.toBeUndefined();
        await expect(store.read()).resolves.toBeNull();
        await expect(store.clear()).resolves.toBeUndefined();
    });
});
