// Commercial PCA Phase W Task 6 — "Export to Word" owner control.
//
// WordExportButton calls useFetcher(), which requires a data-router context
// (react-router throws "useFetcher must be used within a data router"
// otherwise) — every case below renders through createRoutesStub, mirroring
// the CompliancePanel test pattern (app/components/inspection-edit/compliance-panel.test.tsx).
import { render, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { WordExportButton } from "./WordExportButton";

function renderButton(
  opts: {
    available?: boolean;
    action?: (args: { request: Request }) => unknown | Promise<unknown>;
    pollIntervalMs?: number;
  } = {},
) {
  const Stub = createRoutesStub([
    {
      path: "/report-view",
      Component: () => (
        <WordExportButton
          inspectionId="insp-1"
          available={opts.available}
          pollIntervalMs={opts.pollIntervalMs ?? 5}
        />
      ),
      action: opts.action,
    },
  ]);
  return render(<Stub initialEntries={["/report-view"]} />);
}

describe("WordExportButton", () => {
  it("renders the idle 'Export to Word' label", () => {
    const { getByTestId } = renderButton();
    expect(getByTestId("word-export-button").textContent).toBe("Export to Word");
  });

  it("renders nothing when available is false", () => {
    const { container } = renderButton({ available: false });
    expect(container.firstChild).toBeNull();
  });

  it("enqueues, polls building -> ready, and surfaces a download link", async () => {
    let statusCalls = 0;
    const { getByTestId, findByTestId } = renderButton({
      action: async ({ request }) => {
        const formData = await request.formData();
        const intent = formData.get("intent");
        if (intent === "export-word-enqueue") {
          return { ok: true, intent: "export-word-enqueue", exportId: "exp-1" };
        }
        if (intent === "export-word-status") {
          statusCalls += 1;
          if (statusCalls === 1) {
            return { ok: true, intent: "export-word-status", status: "building" };
          }
          return { ok: true, intent: "export-word-status", status: "ready" };
        }
        return { ok: false, intent: String(intent ?? "") };
      },
    });

    fireEvent.click(getByTestId("word-export-button"));

    const link = await findByTestId("word-export-download-link", {}, { timeout: 3000 });
    expect(link.getAttribute("href")).toBe("/api/inspections/insp-1/export/exp-1/download");
    expect(statusCalls).toBeGreaterThanOrEqual(2);
  });

  it("shows Preparing… while queued/building and disables the control", async () => {
    const { getByTestId } = renderButton({
      action: async ({ request }) => {
        const formData = await request.formData();
        const intent = formData.get("intent");
        if (intent === "export-word-enqueue") {
          return { ok: true, intent: "export-word-enqueue", exportId: "exp-2" };
        }
        // Status polls never resolve to ready/failed in this test — stays building forever.
        return { ok: true, intent: "export-word-status", status: "building" };
      },
    });

    fireEvent.click(getByTestId("word-export-button"));

    await waitFor(() => {
      const btn = getByTestId("word-export-button") as HTMLButtonElement;
      expect(btn.textContent).toBe("Preparing…");
      expect(btn.disabled).toBe(true);
    });
  });

  it("renders a disabled control with a tooltip on EXPORT_UNAVAILABLE (503 queue-binding gate)", async () => {
    const { getByTestId, findByTestId } = renderButton({
      action: async () => ({
        ok: false,
        intent: "export-word-enqueue",
        code: "EXPORT_UNAVAILABLE",
        error: "Word export is not configured on this deployment.",
      }),
    });

    fireEvent.click(getByTestId("word-export-button"));

    const unavailable = await findByTestId("word-export-unavailable");
    expect(unavailable.getAttribute("title")).toMatch(/not configured/i);
  });

  it("shows a retry affordance on a generic enqueue failure", async () => {
    const { getByTestId, findByTestId } = renderButton({
      action: async () => ({
        ok: false,
        intent: "export-word-enqueue",
        error: "Word export is only available for commercial PCA reports.",
      }),
    });

    fireEvent.click(getByTestId("word-export-button"));

    const retry = await findByTestId("word-export-retry");
    expect(retry.textContent).toMatch(/retry/i);
  });
});
