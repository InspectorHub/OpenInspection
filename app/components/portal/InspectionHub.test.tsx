// Spec 3 — <InspectionHub> agent-mode chrome gating.
//
// When an agent opens their report link (token-only, no client session; the
// server forces section='report'), the hub hides the client-only tab bar and
// Sign out. Renders through createRoutesStub because the tab bar uses <Link>
// (mirrors the AgentReportActions test pattern).
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import InspectionHub from "./InspectionHub";

const OVERVIEW = {
  address: "1 Test Ave",
  date: "Jul 20, 2026",
} as unknown as Parameters<typeof InspectionHub>[0]["overview"];

const CTX = { tenant: "acme", inspectionId: "insp-1", token: "t", signerToken: null };

function renderHub(agentMode: boolean, onSignOut?: () => void) {
  const Stub = createRoutesStub([
    {
      path: "/portal/acme/i/insp-1",
      Component: () => (
        <InspectionHub
          overview={OVERVIEW}
          ctx={CTX}
          activeSection="report"
          sectionSlot={<div data-testid="report-slot">report body</div>}
          agentMode={agentMode}
          onSignOut={onSignOut}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/portal/acme/i/insp-1"]} />);
}

describe("InspectionHub — agent mode", () => {
  it("hides the client-only tab bar when agentMode is true", () => {
    const { queryByRole } = renderHub(true);
    // Client-hub tabs are rendered as <Link>s (role=link); none should exist.
    expect(queryByRole("link", { name: /overview/i })).toBeNull();
    expect(queryByRole("link", { name: /payment/i })).toBeNull();
    expect(queryByRole("link", { name: /agreement/i })).toBeNull();
  });

  it("still renders the section body (the report slot) in agent mode", () => {
    const { getByTestId } = renderHub(true);
    expect(getByTestId("report-slot")).toBeTruthy();
  });

  it("hides Sign out in agent mode (onSignOut omitted by the route)", () => {
    const { queryByRole } = renderHub(true, undefined);
    expect(queryByRole("button", { name: /sign out/i })).toBeNull();
  });

  it("shows the full tab bar for a normal (client) viewer", () => {
    const { getAllByRole } = renderHub(false, () => {});
    const links = getAllByRole("link").map((l) => l.textContent);
    // The 8 client-hub tabs render.
    expect(links.some((t) => /overview/i.test(t ?? ""))).toBe(true);
    expect(links.some((t) => /payment/i.test(t ?? ""))).toBe(true);
    expect(links.some((t) => /documents/i.test(t ?? ""))).toBe(true);
  });
});
