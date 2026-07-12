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

  it("renders editable reliance textareas seeded from the reliance values", () => {
    const { getByTestId } = renderPanel({
      ...base,
      relianceText: { userReliance: "who may rely", pointInTime: "as of the date", siteSpecific: "site only" },
    });
    const section = getByTestId("reliance-section");
    const textareas = section.querySelectorAll("textarea");
    expect(textareas.length).toBe(3);
    const values = Array.from(textareas).map((t) => (t as HTMLTextAreaElement).value);
    expect(values).toEqual(["who may rely", "as of the date", "site only"]);
  });
});

// Editing a reliance field and blurring it must submit a `save-pca-narrative`
// intent carrying the right key/value — the same route action the narrative
// prose blocks ride (the PATCH schema now declares these three keys, so they
// persist). Wire a real action through createRoutesStub and capture what the
// fetcher submits.
describe("CompliancePanel reliance editing", () => {
  it("submits save-pca-narrative with the correct key/value on blur", async () => {
    const submitted: { intent: FormDataEntryValue | null; key: FormDataEntryValue | null; value: FormDataEntryValue | null }[] = [];

    const Stub = createRoutesStub([
      {
        path: "/inspection-edit",
        Component: () => (
          <CompliancePanel
            inspectionId="i1"
            data={{ ...base, relianceText: { userReliance: "orig reliance", pointInTime: "orig pit", siteSpecific: "orig site" } }}
          />
        ),
        action: async ({ request }) => {
          const fd = await request.formData();
          submitted.push({ intent: fd.get("intent"), key: fd.get("key"), value: fd.get("value") });
          return { ok: true, intent: "save-pca-narrative" };
        },
      },
    ]);
    const { getByTestId } = render(<Stub initialEntries={["/inspection-edit"]} />);

    const section = getByTestId("reliance-section");
    const first = section.querySelectorAll("textarea")[0] as HTMLTextAreaElement;
    fireEvent.change(first, { target: { value: "edited reliance" } });
    fireEvent.blur(first);

    await waitFor(() => expect(submitted.length).toBeGreaterThan(0));
    expect(submitted[0]).toEqual({ intent: "save-pca-narrative", key: "userReliance", value: "edited reliance" });
  });

  it("does not submit when a reliance field is blurred without an edit", async () => {
    const submitted: FormDataEntryValue[] = [];

    const Stub = createRoutesStub([
      {
        path: "/inspection-edit",
        Component: () => <CompliancePanel inspectionId="i1" data={base} />,
        action: async ({ request }) => {
          const fd = await request.formData();
          const intent = fd.get("intent");
          if (intent) submitted.push(intent);
          return { ok: true, intent: "save-pca-narrative" };
        },
      },
    ]);
    const { getByTestId } = render(<Stub initialEntries={["/inspection-edit"]} />);

    // Tab through (focus + blur) every reliance textarea without changing any
    // value — the dirty check must suppress every no-op save/audit write.
    const section = getByTestId("reliance-section");
    for (const ta of Array.from(section.querySelectorAll("textarea"))) {
      fireEvent.focus(ta);
      fireEvent.blur(ta);
    }

    await new Promise((r) => setTimeout(r, 20));
    expect(submitted).toEqual([]);
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
