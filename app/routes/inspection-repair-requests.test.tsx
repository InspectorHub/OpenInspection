// @vitest-environment happy-dom
/**
 * #69 — the Repair Request Log, pinned at the two places it can silently go
 * wrong.
 *
 * 1. THE PUBLISH GATE. The industry surface this copies withholds the log until
 *    the report is published, and the server refuses to query the lists on that
 *    branch. The view model repeats the rule, so this asserts on the OUTPUT a
 *    reader gets rather than on which branch ran: a payload that carries lists
 *    alongside `published: false` must still render none. That combination is
 *    not hypothetical — it is exactly what a later refactor of the endpoint
 *    produces when someone hoists the query above the gate.
 *
 * 2. NO WRITE AFFORDANCE. The log renders the client's `repair_action_tag`, and
 *    the one component in the repo that renders that field for authoring is a
 *    `<select>` whose writes the API refuses from staff
 *    (`mayAuthorRepairActionTag`). "Read-only" is therefore a property of the
 *    DOM, not of the prose in a header comment, and it is asserted as one.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import InspectionRepairRequestsPage, {
  repairLogViewModel,
  type RepairLogApiData,
} from "./inspection-repair-requests";

const ITEM = {
  id: "it1",
  sectionTitle: "Roof",
  itemLabel: "Shingles",
  defectTitleSnapshot: "Missing shingles",
  locationSnapshot: "North slope",
  categorySnapshot: "safety",
  commentSnapshot: "Several shingles are cracked.",
  note: "Please have this done before closing.",
  requestedCreditCents: 50000,
  repairActionTag: "replace" as const,
};

const LIST = {
  id: "rr1",
  createdByKind: "client" as const,
  createdByRef: "buyer@example.com",
  customIntro: "Here is what we would like addressed.",
  createdAt: Date.UTC(2026, 6, 1, 15, 0, 0),
  items: [ITEM],
};

function renderLog(data: RepairLogApiData) {
  const vm = repairLogViewModel(data);
  const Stub = createRoutesStub([
    {
      path: "/inspections/:id/repair-requests",
      Component: InspectionRepairRequestsPage,
      loader: () => ({ kind: "ok", inspectionId: "insp1", vm }),
    },
  ]);
  return render(<Stub initialEntries={["/inspections/insp1/repair-requests"]} />);
}

describe("repair request log — the publish gate", () => {
  it("renders no list when the report is not published", async () => {
    // The payload deliberately CARRIES a list. A test that passed an empty
    // `lists` array would pass with the gate deleted, because there would be
    // nothing to render either way.
    const { findByTestId, queryByTestId, queryByText } = renderLog({
      propertyAddress: "1 Main St",
      published: false,
      lists: [LIST],
    });

    await findByTestId("repair-log-unpublished");
    expect(queryByTestId("repair-log-entry-rr1")).toBeNull();
    expect(queryByTestId("repair-log-item")).toBeNull();
    // Not just the container — none of the buyer's words reach the page.
    expect(queryByText(/buyer@example\.com/)).toBeNull();
    expect(queryByText(/Please have this done before closing\./)).toBeNull();
  });

  it("says the log opens on publication rather than claiming there is nothing", async () => {
    // "No repair requests yet" would be a false answer before publication:
    // none can exist. The two states must not collapse into one message.
    const { findByTestId, queryByText } = renderLog({ published: false, lists: [] });
    const banner = await findByTestId("repair-log-unpublished");
    expect(banner.textContent).toContain("published");
    expect(queryByText(/No repair requests yet/)).toBeNull();
  });

  it("drops the lists in the view model itself, not only in the markup", () => {
    // The gate lives in the pure function, so an unpublished payload cannot
    // reach a future consumer of the model either.
    const vm = repairLogViewModel({ published: false, lists: [LIST] });
    expect(vm.published).toBe(false);
    expect(vm.lists).toEqual([]);
  });

  it("renders the list once the report is published", async () => {
    // The mirror of the first case: proves the gate is what withheld the list,
    // not a payload the page could never render.
    const { findByTestId } = renderLog({
      propertyAddress: "1 Main St",
      published: true,
      lists: [LIST],
    });
    const entry = await findByTestId("repair-log-entry-rr1");
    expect(entry.textContent).toContain("buyer@example.com");
    expect(entry.textContent).toContain("Missing shingles");
  });
});

describe("repair request log — read only", () => {
  it("renders no form control at all", async () => {
    const { findByTestId, container } = renderLog({ published: true, lists: [LIST] });
    await findByTestId("repair-log-entry-rr1");

    // The tag control on the client builder is a `<select>`; the credit field
    // is an `<input>`; the note field is a `<textarea>`. Asserting the absence
    // of the SPECIFIC element each one uses would pass the day somebody swaps
    // one for another, so this asserts there is no writable control of any kind.
    expect(container.querySelectorAll("select").length).toBe(0);
    expect(container.querySelectorAll("input").length).toBe(0);
    expect(container.querySelectorAll("textarea").length).toBe(0);
    expect(container.querySelectorAll("button").length).toBe(0);
    expect(container.querySelectorAll("form").length).toBe(0);
  });

  it("shows the buyer's requested action as text, localized, not as a chooser", async () => {
    const { findByTestId } = renderLog({ published: true, lists: [LIST] });
    const tag = await findByTestId("repair-log-ask-tag");
    expect(tag.textContent).toContain("Replace");
    // The stored value is `replace`. A page rendering it verbatim looks right
    // in English and is untranslatable everywhere else.
    expect(tag.textContent).not.toContain("replace");
    expect(tag.tagName).not.toBe("SELECT");
    expect(tag.querySelector("select")).toBeNull();
  });

  it("omits the whole ask block for an item nobody asked anything about", async () => {
    // Every item added before #275 has no tag, and an untagged item with no
    // note and no credit is a valid item forever. An empty "Asked for" heading
    // would claim the buyer was asked and declined to answer.
    const { findByTestId, queryByTestId } = renderLog({
      published: true,
      lists: [
        {
          ...LIST,
          items: [
            {
              ...ITEM,
              note: null,
              requestedCreditCents: null,
              repairActionTag: null,
            },
          ],
        },
      ],
    });
    await findByTestId("repair-log-item");
    expect(queryByTestId("repair-log-ask")).toBeNull();
  });
});

describe("repair request log — the log is many lists", () => {
  it("renders one entry per list, each attributed to who built it", async () => {
    // Spectora calls it a Log because an order collects several: the buyer's,
    // their agent's, sometimes a second buyer's. A page that rendered only the
    // newest would look correct on every single-list order.
    const { findByTestId } = renderLog({
      published: true,
      lists: [
        LIST,
        {
          ...LIST,
          id: "rr2",
          createdByKind: "agent" as const,
          createdByRef: "agent@example.com",
        },
      ],
    });
    const first = await findByTestId("repair-log-entry-rr1");
    const second = await findByTestId("repair-log-entry-rr2");
    expect(first.textContent).toContain("buyer@example.com");
    expect(first.textContent).toContain("Client");
    expect(second.textContent).toContain("agent@example.com");
    expect(second.textContent).toContain("Agent");
  });

  it("totals only the credits actually asked for on a list", () => {
    const vm = repairLogViewModel({
      published: true,
      lists: [
        {
          ...LIST,
          items: [
            { ...ITEM, id: "a", requestedCreditCents: 50000 },
            { ...ITEM, id: "b", requestedCreditCents: null },
            { ...ITEM, id: "c", requestedCreditCents: 2500 },
          ],
        },
      ],
    });
    expect(vm.lists[0]?.creditTotalCents).toBe(52500);
  });
});
