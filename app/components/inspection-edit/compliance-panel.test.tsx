import { render, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub, useLoaderData } from "react-router";
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

// The doc-review seed button renders straight off loader props (no local
// optimistic copy, unlike PsqPanel/DocReviewRow) — a successful seed must
// trigger `revalidator.revalidate()` or the checklist appears to do nothing.
// This wires a real loader + action through createRoutesStub (mirroring the
// units revalidation pattern in inspection-edit.tsx) so the seed → revalidate
// → refetched loader data → rows-appear round trip is exercised end to end,
// not just asserted against a mock.
describe("CompliancePanel doc-review seed revalidation", () => {
  it("shows the seeded rows after the seed submit succeeds, via revalidation", async () => {
    let seeded = false;

    function StubbedPanel() {
      const loaderData = useLoaderData() as CompliancePanelData;
      return <CompliancePanel inspectionId="i1" data={loaderData} />;
    }

    const Stub = createRoutesStub([
      {
        path: "/inspection-edit",
        Component: StubbedPanel,
        loader: () => ({
          ...base,
          documentReview: seeded
            ? [{ documentKey: "prior_pcrs", label: "Prior PCRs", requested: false, received: false, reviewed: false, na: false, notes: null }]
            : [],
        }),
        action: () => {
          seeded = true;
          return { ok: true, intent: "compliance-doc-review-seed" };
        },
      },
    ]);
    const { getByText, findByText, queryByText } = render(<Stub initialEntries={["/inspection-edit"]} />);

    const seedButton = await findByText("Load standard checklist");
    expect(queryByText("Prior PCRs")).toBeNull();
    fireEvent.click(seedButton);

    await waitFor(() => expect(getByText("Prior PCRs")).toBeTruthy());
  });
});
