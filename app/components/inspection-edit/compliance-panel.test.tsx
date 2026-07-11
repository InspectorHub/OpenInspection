import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { CompliancePanel, type CompliancePanelData } from "~/components/inspection-edit/CompliancePanel";

const base: CompliancePanelData = {
  reportSignoffs: [],
  psq: null,
  documentReview: [],
  conformance: { standard: "E2018-24", conforms: false },
  relianceText: { userReliance: "a", pointInTime: "b", siteSpecific: "c" },
};

// CompliancePanel's sub-sections call useFetcher() internally, which needs a
// data-router context to render — createRoutesStub (react-router's official
// test helper) provides one without a real app router. No `action` is
// declared on the stub route: neither test below submits a fetcher.
function renderPanel(data: CompliancePanelData) {
  const Stub = createRoutesStub([
    { path: "/inspection-edit", Component: () => <CompliancePanel inspectionId="i1" data={data} /> },
  ]);
  return render(<Stub initialEntries={["/inspection-edit"]} />);
}

describe("CompliancePanel", () => {
  it("shows the conformance preview as non-conformant with no reviewer", () => {
    const { getByText } = renderPanel(base);
    expect(getByText(/not conform|non-?conformant/i)).toBeTruthy();
  });

  it("lists the document-review items", () => {
    const { getByText } = renderPanel({
      ...base,
      documentReview: [
        { documentKey: "prior_pcrs", label: "Prior PCRs", requested: false, received: false, reviewed: false, na: false, notes: null },
      ],
    });
    expect(getByText("Prior PCRs")).toBeTruthy();
  });
});
