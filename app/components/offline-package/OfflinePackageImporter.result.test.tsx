// @vitest-environment happy-dom
/**
 * The offline-package import page: the result, and the reasons shown for what was left behind.
 * Every negative assertion has a positive control beside it. Harness: `importer-test-kit`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { readPackageSummary } from "@core/offline-package";
import { SIGNED_OUT_SENTENCE, ok, refused, runToResult, three } from "~/components/offline-package/importer-test-kit";
import { engineReads } from "../../../tests/unit/helpers/offline-package-cases";
import type { Respond } from "~/components/offline-package/importer-test-kit";

beforeEach(() => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("the result", () => {
    it("counts what was imported, and offers the repeat only when something was left behind", async () => {
        await runToResult(three, (_n, b) => ok(b, { skipped: 0 }));
        const result = screen.getByTestId("offline-package-result");
        expect(within(result).getByText("Imported").nextSibling?.textContent).toBe("3");
        expect(within(result).getByText("Needs attention").nextSibling?.textContent).toBe("0");
        expect(within(result).getByText("Everything in this package was imported.")).toBeTruthy();
        expect(screen.queryByTestId("offline-package-held-back")).toBeNull();
        expect(screen.queryByRole("button", { name: "Import this file again" })).toBeNull();
    });

    it("says so when a package that was already imported changes nothing", async () => {
        await runToResult(three, (_n, b) => ok(b, { skipped: 2, applied: 0 }));
        const result = screen.getByTestId("offline-package-result");
        expect(within(result).getByText("Skipped").nextSibling?.textContent).toBe("2");
        expect(within(result).getByText(/had already been imported, so nothing changed/)).toBeTruthy();
        expect(within(result).queryByText("Everything in this package was imported.")).toBeNull();
    });

    it("lists a refused queued change on its own, as something to look at and not as a failed import", async () => {
        const failed = [{ idempotencyKey: "k-update-insp-1-0", op: "inspection.update", inspectionId: "insp-1", status: 403, reason: "forbidden" }];
        await runToResult(three, (_n, b) => ok(b, { failed }));
        const attention = screen.getByTestId("offline-package-attention");
        expect(attention.textContent).toContain("inspection.update on inspection insp-1");
        expect(attention.textContent).toContain("Server answer: 403");
        expect(attention.textContent).toContain("Reason: forbidden");
        const result = screen.getByTestId("offline-package-result");
        expect(within(result).getByText("Imported").nextSibling?.textContent).toBe("3");
        expect(within(result).getByText("Needs attention").nextSibling?.textContent).toBe("1");
        expect(screen.queryByTestId("offline-package-held-back")).toBeNull();
    });

    it("shows each inspection that was left behind with its reason and the server answer, and downloads it as a valid package of its own", async () => {
        await runToResult(three, (_n, b) => {
            const ids = readPackageSummary(b).manifest.inspections.map((i) => i.id);
            return ids.includes("insp-1") && ids.length === 3 ? refused(404, "NOT_FOUND", { inspectionId: "insp-1" }) : ok(b);
        });
        const rows = screen.getAllByTestId("held-back-row");
        expect(rows).toHaveLength(1);
        expect(rows[0]!.textContent).toContain("Inspection insp-1");
        expect(rows[0]!.textContent).toContain("Not found");
        expect(rows[0]!.textContent).toContain("Server answer: 404 NOT_FOUND");
        const result = screen.getByTestId("offline-package-result");
        expect(within(result).getByText("Imported").nextSibling?.textContent).toBe("2");
        expect(screen.getByText(/does not exist in this company/)).toBeTruthy();

        const created: Blob[] = [];
        (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mockImplementation((blob: Blob) => { created.push(blob); return "blob:held-back"; });
        await act(async () => { fireEvent.click(within(rows[0]!).getByRole("button", { name: "Download this part" })); });
        expect(created).toHaveLength(1);
        const downloaded = new Uint8Array(await created[0]!.arrayBuffer());
        const verdict = engineReads(downloaded);
        expect(verdict.ok).toBe(true);
        expect(verdict.ok && verdict.view.ids).toEqual(["insp-1"]);
        // It carries that inspection's own queued change, and not the others'.
        expect(verdict.ok && verdict.view.writes.get("insp-1")).toEqual(["k-update-insp-1-0"]);
        expect(readPackageSummary(downloaded).manifest.tenantId).toBe("tenant-1");
    });

    it("writes the explanation once for a refusal of the whole package and still lists every inspection", async () => {
        await runToResult(three, () => refused(400, "BAD_REQUEST"));
        expect(screen.getAllByTestId("held-back-row")).toHaveLength(3);
        expect(screen.getAllByText(/refused the package as a whole/)).toHaveLength(1);
        for (const row of screen.getAllByTestId("held-back-row")) expect(row.textContent).toContain("Server answer: 400 BAD_REQUEST");
        expect(screen.getByText("Nothing in this package could be imported. Your file has not been changed: read why below, then import it again.")).toBeTruthy();
    });

    it("downloads a whole group as one valid package", async () => {
        await runToResult(three, () => refused(400, "BAD_REQUEST"));
        const created: Blob[] = [];
        (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mockImplementation((blob: Blob) => { created.push(blob); return "blob:group"; });
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Download these 3 as one package" })); });
        const verdict = engineReads(new Uint8Array(await created[0]!.arrayBuffer()));
        expect(verdict.ok && verdict.view.ids).toEqual(three.ids);
    });
});

describe("reasons for a package the server refused as a whole", () => {
    it.each([
        [401, "UNAUTHORIZED"],
        [403, "FORBIDDEN"],
    ])("a %s says the session or permission may be the problem, and that the file is unchanged", async (status, code) => {
        await runToResult(three, () => refused(status, code));
        expect(screen.getAllByText(SIGNED_OUT_SENTENCE)).toHaveLength(1);
        expect(screen.getByText(/Sign in again and import again; your file has not been changed\./)).toBeTruthy();
        for (const row of screen.getAllByTestId("held-back-row")) expect(row.textContent).toContain(`Server answer: ${status} ${code}`);
    });

    it("does not read a 403 about one inspection as a signed-out session (positive control)", async () => {
        await runToResult(three, (_n, b) => {
            const ids = readPackageSummary(b).manifest.inspections.map((i) => i.id);
            return ids.length === 3 ? refused(403, "FORBIDDEN", { inspectionId: "insp-2" }) : ok(b);
        });
        expect(screen.getByText(/not allowed to change this inspection/)).toBeTruthy();
        expect(screen.queryByText(SIGNED_OUT_SENTENCE)).toBeNull();
    });

    it("states the number of days the server named for an expired package", async () => {
        await runToResult(three, () => refused(422, "PACKAGE_EXPIRED", { maxAgeDays: 123 }));
        expect(screen.getByText(/more than 123 days old and can no longer be imported/)).toBeTruthy();
        expect(screen.queryByText(/ahead of the server/)).toBeNull();
        expect(screen.queryByText(SIGNED_OUT_SENTENCE)).toBeNull();
    });

    it("states the number of days the server named for a package dated in the future", async () => {
        await runToResult(three, () => refused(422, "PACKAGE_FROM_THE_FUTURE", { maxFutureSkewDays: 7 }));
        expect(screen.getByText(/more than 7 days ahead of the server's clock/)).toBeTruthy();
        expect(screen.queryByText(/days old and can no longer be imported/)).toBeNull();
    });

    it("says '1 day', not '1 days', for a one-day allowance", async () => {
        await runToResult(three, () => refused(422, "PACKAGE_FROM_THE_FUTURE", { maxFutureSkewDays: 1 }));
        expect(screen.getByText(/more than 1 day ahead of the server's clock/)).toBeTruthy();
    });

    it("falls back to the documented figures when the server named none", async () => {
        await runToResult(three, () => refused(422, "PACKAGE_EXPIRED"));
        expect(screen.getByText(/more than 400 days old/)).toBeTruthy();
    });
});

describe("other reasons an inspection is left behind", () => {
    const named = (status: number, code: string, details: Record<string, unknown> = {}): Respond => (_n, b) => {
        const ids = readPackageSummary(b).manifest.inspections.map((i) => i.id);
        return ids.length === 3 ? refused(status, code, { inspectionId: "insp-2", ...details }) : ok(b);
    };

    it.each([
        ["deleted", 409, "PACKAGE_INSPECTION_DELETED", {}, "Deleted", /deleted after the package was exported/],
        ["different_report", 400, "BAD_REQUEST", {}, "Different report", /not the report this inspection has now/],
        ["apply_failed", 422, "UNPROCESSABLE", { reason: "photo_rejected" }, "Change refused", /could not apply/],
        ["refused", 418, "TEAPOT", {}, "Refused", /reason this version does not recognize/],
    ])("%s gets its own sentence and next step", async (_reason, status, code, details, label, sentence) => {
        await runToResult(three, named(status, code, details));
        const row = screen.getByTestId("held-back-row");
        expect(row.textContent).toContain(label);
        expect(row.textContent).toContain(`Server answer: ${status} ${code}`);
        expect(screen.getByText(sentence)).toBeTruthy();
        if ("reason" in details) expect(row.textContent).toContain("Server detail: photo_rejected");
    });

    it("tells a person to import again later when the server never confirmed, and that this is safe", async () => {
        await runToResult(three, () => "throw");
        expect(screen.getAllByTestId("held-back-row")).toHaveLength(3);
        expect(screen.getByText(/did not confirm this part in time/)).toBeTruthy();
        expect(screen.getByText(/Import the same file again later: importing is safe to repeat/)).toBeTruthy();
        expect(screen.getAllByText("No confirmed answer from the server")).toHaveLength(3);
    });

    it("can import the same file again from the result, and then everything arrives", async () => {
        let offline = true;
        const { fetchMock } = await runToResult(three, (_n, b) => (offline ? "throw" : ok(b)));
        offline = false;
        const before = fetchMock.mock.calls.length;
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Import this file again" })); });
        await waitFor(() => expect(screen.queryByTestId("offline-package-held-back")).toBeNull());
        expect(fetchMock.mock.calls.length).toBe(before + 1);
        expect(within(screen.getByTestId("offline-package-result")).getByText("Imported").nextSibling?.textContent).toBe("3");
    });
});

