// Spec 3 Task 3 — <AgentReportActions> report-landing CTA.
//
// AgentReportActions calls useFetcher(), which requires a data-router context
// (react-router throws "useFetcher must be used within a data router"
// otherwise) — every case below renders through createRoutesStub, mirroring
// the WordExportButton test pattern (app/components/portal/sections/report/word-export-button.test.tsx).
import { render, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { AgentReportActions } from "./AgentReportActions";

const BASE_PROPS = {
  tenant: "acme",
  inspectionId: "insp-1",
  token: "report-token-abc",
  recipientEmail: "agent@example.com",
  reportPath: "/portal/acme/i/insp-1?token=report-token-abc&to=report",
};

function renderActions(
  hasAccount: boolean,
  action?: (args: { request: Request }) => unknown | Promise<unknown>,
) {
  const Stub = createRoutesStub([
    {
      path: "/portal/acme/i/insp-1",
      Component: () => <AgentReportActions {...BASE_PROPS} hasAccount={hasAccount} />,
      action,
    },
  ]);
  return render(<Stub initialEntries={["/portal/acme/i/insp-1"]} />);
}

describe("AgentReportActions — registered agent (hasAccount: true)", () => {
  it('renders the "Go to my workspace" CTA', () => {
    const { getByTestId } = renderActions(true);
    expect(getByTestId("agent-report-workspace-cta").textContent).toBe("Go to my workspace");
  });

  it("submitting posts the agent-magic-login intent with tenant/inspectionId/token", async () => {
    let submitted: Record<string, FormDataEntryValue | null> | null = null;
    const { getByTestId } = renderActions(true, async ({ request }) => {
      const formData = await request.formData();
      submitted = Object.fromEntries(formData.entries());
      return { ok: true, intent: "agent-magic-login", loginUrl: null };
    });

    fireEvent.click(getByTestId("agent-report-workspace-cta"));

    await waitFor(() => {
      expect(submitted).toEqual({
        intent: "agent-magic-login",
        tenant: "acme",
        inspectionId: "insp-1",
        token: "report-token-abc",
      });
    });
  });

  it("shows an error message when the action reports failure", async () => {
    const { getByTestId, findByText } = renderActions(true, async () => ({
      ok: false,
      intent: "agent-magic-login",
    }));

    fireEvent.click(getByTestId("agent-report-workspace-cta"));

    await findByText(/couldn't sign you in/i);
  });
});

describe("AgentReportActions — unregistered agent (hasAccount: false)", () => {
  it("renders the signup CTA with the correct email + returnTo query params", () => {
    const { getByTestId } = renderActions(false);
    const link = getByTestId("agent-report-signup-cta") as HTMLAnchorElement;
    expect(link.textContent).toBe("Create your free agent account");

    const href = new URL(link.getAttribute("href")!, "https://example.test");
    expect(href.pathname).toBe("/agent-signup");
    expect(href.searchParams.get("email")).toBe("agent@example.com");
    expect(href.searchParams.get("returnTo")).toBe(BASE_PROPS.reportPath);
  });

  it("does not render the workspace CTA", () => {
    const { queryByTestId } = renderActions(false);
    expect(queryByTestId("agent-report-workspace-cta")).toBeNull();
  });
});
