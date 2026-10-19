// @vitest-environment happy-dom
/**
 * The offline-package import page: choosing, previewing, confirming and running.
 * Every negative assertion has a positive control beside it. Harness: `importer-test-kit`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IMPORT_LIMIT_CEILINGS, readPackageSummary } from "@core/offline-package";
import { OfflinePackageImporter } from "~/components/offline-package/OfflinePackageImporter";
import {
    NO_WAIT, choose, confirmImport, fileOf, ok, openConfirm, refused, renderPage, runToResult, stubNetwork, three,
} from "~/components/offline-package/importer-test-kit";
import { buildPackage } from "../../../tests/unit/helpers/offline-package-fixture";

beforeEach(() => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("choosing a file", () => {
    it("shows what the package holds and sends nothing", async () => {
        const { fetchMock } = stubNetwork((_n, b) => ok(b));
        renderPage();
        await choose(fileOf(three.zip));
        const preview = await screen.findByTestId("offline-package-preview");
        const summary = readPackageSummary(three.zip);
        expect(within(preview).getByText("Inspections").nextSibling?.textContent).toBe("3");
        expect(within(preview).getByText("Queued changes").nextSibling?.textContent).toBe(String(summary.counts.writes));
        expect(within(preview).getByText("Photos").nextSibling?.textContent).toBe("1");
        expect(within(preview).getByText("device-1")).toBeTruthy();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        ["a file that is not a .zip", () => fileOf("hello", "notes.txt"), /not a \.zip package/],
        ["an empty file", () => fileOf(new Uint8Array(), "empty.zip"), /empty/],
        ["a .zip that is not an offline package", () => fileOf("not a zip at all", "fake.zip"), /not a valid offline package/],
        ["a file over the size limit", () => {
            const big = fileOf(new Uint8Array(8), "big.zip");
            Object.defineProperty(big, "size", { value: IMPORT_LIMIT_CEILINGS.compressedBytes + 1 });
            return big;
        }, /over the 24 MB limit/],
    ])("refuses %s with a reason, and sends nothing", async (_name, make, message) => {
        const { fetchMock } = stubNetwork((_n, b) => ok(b));
        renderPage();
        await choose(make());
        expect((await screen.findByRole("alert")).textContent).toMatch(message);
        expect(screen.queryByTestId("offline-package-preview")).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("accepts a valid .zip (positive control for the refusals above)", async () => {
        stubNetwork((_n, b) => ok(b));
        renderPage();
        await choose(fileOf(three.zip));
        expect(await screen.findByTestId("offline-package-preview")).toBeTruthy();
        expect(screen.queryByRole("alert")).toBeNull();
    });
});

describe("a package from another company", () => {
    it("warns and keeps the import button disabled", async () => {
        const { fetchMock } = stubNetwork((_n, b) => ok(b));
        render(<OfflinePackageImporter tenantId="some-other-company" locale="en" timeZone="UTC" importOptions={NO_WAIT} />);
        await choose(fileOf(three.zip));
        expect((await screen.findByRole("alert")).textContent).toMatch(/belongs to a different company/);
        const button = screen.getByRole("button", { name: "Review and import" }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        await act(async () => { fireEvent.click(button); });
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("lets a package for this company through (positive control)", async () => {
        stubNetwork((_n, b) => ok(b));
        renderPage("tenant-1");
        await choose(fileOf(three.zip));
        await screen.findByTestId("offline-package-preview");
        expect((screen.getByRole("button", { name: "Review and import" }) as HTMLButtonElement).disabled).toBe(false);
        expect(screen.getByText(/exported for this company/)).toBeTruthy();
        expect(screen.queryByText(/belongs to a different company/)).toBeNull();
    });

    it("treats a session whose company is unknown as a mismatch, never a match", async () => {
        stubNetwork((_n, b) => ok(b));
        renderPage("");
        await choose(fileOf(three.zip));
        await screen.findByTestId("offline-package-preview");
        expect((screen.getByRole("button", { name: "Review and import" }) as HTMLButtonElement).disabled).toBe(true);
    });
});

describe("confirming", () => {
    it("asks first, in a dialog that names the personal-information responsibility, and sends nothing until confirmed", async () => {
        const { fetchMock } = stubNetwork((_n, b) => ok(b));
        renderPage();
        await choose(fileOf(three.zip));
        const dialog = await openConfirm();
        expect(dialog.textContent).toContain(
            "This file contains client personal information and is not encrypted. Keeping it safe, and deleting it afterwards, is your company's responsibility.",
        );
        expect(fetchMock).not.toHaveBeenCalled();

        await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })); });
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.getByTestId("offline-package-preview")).toBeTruthy();

        await confirmImport();
        await screen.findByTestId("offline-package-result");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("sends the package once when the confirm button is pressed twice in the same frame", async () => {
        const { fetchMock } = stubNetwork((_n, b) => ok(b));
        renderPage();
        await choose(fileOf(three.zip));
        const dialog = await openConfirm();
        const button = within(dialog).getByRole("button", { name: "Import package" });
        await act(async () => {
            button.click();
            button.click();
        });
        await screen.findByTestId("offline-package-result");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("sends again on a later press, once the first import is over (the guard is not a dead button)", async () => {
        const { fetchMock } = await runToResult(three, (_n, b) => ok(b));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        // Everything imported: start over with another package and import it too.
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Import another package" })); });
        await choose(fileOf(three.zip));
        await confirmImport();
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    });
});

describe("while it runs", () => {
    it("shows the part being sent and sends the parts one at a time", async () => {
        let release: (() => void) | undefined;
        let inFlight = 0;
        let peak = 0;
        const parts: string[][] = [];
        const { fetchMock } = stubNetwork(async (n, bytes) => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            parts.push(readPackageSummary(bytes).manifest.inspections.map((i) => i.id));
            if (n === 1) {
                // The server names one inspection; the other two are sent as the next part.
                await new Promise<void>((resolve) => { release = resolve; });
                inFlight--;
                return refused(404, "NOT_FOUND", { inspectionId: "insp-1" });
            }
            inFlight--;
            return ok(bytes);
        });
        renderPage();
        await choose(fileOf(three.zip));
        await confirmImport();
        const progress = await screen.findByTestId("offline-package-progress");
        expect(progress.textContent).toContain("Sending part 1 of 1");
        expect(within(progress).getByRole("progressbar")).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await act(async () => { release?.(); });
        await screen.findByTestId("offline-package-result");
        expect(parts).toEqual([["insp-0", "insp-1", "insp-2"], ["insp-0", "insp-2"]]);
        expect(peak).toBe(1);
    });
});

describe("a package the browser can read but the import cannot", () => {
  it("never sends a package whose entries disagree (preview reads only the indexes, the import reads it all)", async () => {
        const broken = buildPackage({
            tenantId: "tenant-1",
            inspections: [{ id: "insp-0", reportId: "rep-0" }],
            // No Yjs state for the inspection: the summary reads fine, the full parse refuses.
        });
        const { fetchMock } = stubNetwork((_n, b) => ok(b));
        renderPage();
        await choose(fileOf(broken));
        await confirmImport();
        expect((await screen.findByRole("alert")).textContent).toMatch(/not a valid offline package/);
        expect(fetchMock).not.toHaveBeenCalled();
        // Still on the preview, so the person can pick another file.
        expect(screen.getByRole("button", { name: "Choose a different file" })).toBeTruthy();
    });
});

