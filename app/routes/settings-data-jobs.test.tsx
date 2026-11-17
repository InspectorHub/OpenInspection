// @vitest-environment happy-dom
/**
 * The web export-status page. The web never runs an export; it only lists the
 * jobs the desktop app reported and offers cancel for still-active ones. These
 * assertions pin that: a finished job has no cancel control, an active one has
 * a guarded one, and an empty ledger says so.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";

// The guarded submit mints a key on mount via crypto.randomUUID.
if (!globalThis.crypto?.randomUUID) {
    Object.defineProperty(globalThis, "crypto", {
        value: { ...globalThis.crypto, randomUUID: () => "test-idempotency-key" },
        configurable: true,
    });
}

import SettingsDataJobs from "~/routes/settings-data-jobs";

interface JobRow {
    id: string; kind: string; status: string; stage: string;
    leaseExpiresAt: string | null; createdAt: string; finishedAt: string | null; errorCode: string | null;
}

function renderPage(jobs: JobRow[], opts: { forbidden?: boolean; loadFailed?: boolean } = {}) {
    const Stub = createRoutesStub([
        {
            id: "routes/auth-layout", path: "/",
            loader: () => ({ context: { branding: { defaultLocale: "en-US", defaultTimezone: "UTC" }, user: {} } }),
            Component: () => <Outlet />,
            children: [{
                path: "settings/data/jobs",
                Component: SettingsDataJobs,
                loader: () => ({ forbidden: opts.forbidden ?? false, loadFailed: opts.loadFailed ?? false, jobs }),
            }],
        },
    ]);
    return render(<Stub initialEntries={["/settings/data/jobs"]} />);
}

const job = (over: Partial<JobRow>): JobRow => ({
    id: "job-1", kind: "export", status: "running", stage: "rows",
    leaseExpiresAt: null, createdAt: "2026-01-01T00:00:00.000Z", finishedAt: null, errorCode: null,
    ...over,
});

describe("settings → data jobs", () => {
    it("shows the empty state when no export has been started", async () => {
        renderPage([]);
        expect(await screen.findByText(/No data-package jobs yet/i)).toBeTruthy();
    });

    it("lists a job with its status and offers cancel only while it is active", async () => {
        renderPage([
            job({ id: "job-running", status: "running" }),
            job({ id: "job-done", status: "complete" }),
        ]);
        expect(await screen.findByText("job-running")).toBeTruthy();
        expect(screen.getByText("job-done")).toBeTruthy();
        const cancels = screen.getAllByRole("button", { name: /cancel/i });
        expect(cancels).toHaveLength(1);
    });

    it("renders AccessDenied for a non-owner instead of the ledger", async () => {
        renderPage([], { forbidden: true });
        expect(await screen.findByText(/admins only/i)).toBeTruthy();
        expect(screen.queryByText(/No data-package jobs yet/i)).toBeNull();
    });

    it("shows a load error instead of claiming no exports when the API fails", async () => {
        renderPage([], { loadFailed: true });
        expect(await screen.findByText(/Couldn't load the export status/i)).toBeTruthy();
        expect(screen.queryByText(/No data-package jobs yet/i)).toBeNull();
    });
});
