// @vitest-environment happy-dom
/**
 * The same entity must read the same in both portals.
 *
 * The agent portal used to hand-roll its own repair-item row while the client
 * portal rendered the same defect through RepairDefectRow. That fork is why the
 * agent side silently lost photos and the item label, and why terminology
 * drifted between the two. This test fails if a future change re-forks the row:
 * it renders one defect through BOTH portals' entry points and compares what a
 * reader actually sees.
 *
 * It compares rendered text, not imports — a copy-pasted component that happens
 * to match today is still a fork tomorrow, and this catches it the moment the
 * two diverge.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { RepairDefectRow } from "~/components/portal/sections/repair/RepairDefectRow";
import { AgentRepairInspectionBlock } from "~/components/agent/AgentRepairInspectionBlock";
import { RepairRequestLogEntry } from "~/components/inspector-portal/RepairRequestLogEntry";
import type { Defect } from "~/components/portal/sections/RepairBuilderSection";

const DEFECT = {
  findingKey: "f1",
  sectionId: "s1",
  sectionTitle: "Roof",
  itemId: "i1",
  itemLabel: "Shingles",
  defectTitle: "Missing shingles",
  location: "North slope",
  comment: "Replace missing shingles.",
  category: "safety",
  severityBucket: "defect",
} as Defect;

/** Text a reader sees, with whitespace collapsed. */
function readable(el: HTMLElement): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("one defect, two portals", () => {
  it("reads identically in the client repair builder and the agent portal", async () => {
    const client = render(
      <RepairDefectRow
        defect={DEFECT}
        isSelected={false}
        draft={undefined}
        creditCents={null}
        // #275 — supplied but null, and the guard is deliberately NOT extended to
        // compare the tag. This case renders with isSelected={false}, so the
        // expanded region holding the tag control never renders; a tag absent from
        // both portals would compare equal and the assertion would pass for the
        // wrong reason. Extending it needs isSelected={true} AND a tag on the agent
        // side, which has no join key to resolve one (plan Task 3a).
        actionTag={null}
        onToggle={() => {}}
        onUpdateCredit={() => {}}
        onUpdateNote={() => {}}
        onUpdateTag={() => {}}
      />,
    );

    const Stub = createRoutesStub([
      {
        path: "/agent-repair-items",
        Component: () => (
          <AgentRepairInspectionBlock
            inspectionId="i1"
            tenantName="Acme Inspections"
            tenantSlug="acme"
            repairAccess="readwrite"
            rows={[
              {
                inspectionId: "i1",
                repairAccess: "readwrite",
                sectionTitle: DEFECT.sectionTitle,
                itemLabel: DEFECT.itemLabel,
                defectTitle: DEFECT.defectTitle,
                location: DEFECT.location,
                comment: DEFECT.comment,
                category: DEFECT.category,
                isCustom: false,
                photos: [],
              },
            ]}
            photosFor={() => []}
          />
        ),
      },
    ]);
    const agent = render(<Stub initialEntries={["/agent-repair-items"]} />);
    const agentRow = await agent.findByTestId("repair-row-i1-0");

    // Every part of the defect a client sees, an agent sees too — same words,
    // same order.
    expect(readable(agentRow)).toBe(readable(client.container));
  });

  it("reads identically in the inspection company's repair request log (#69)", async () => {
    // Three audiences now. The staff log renders the SAME defect back to the
    // company that wrote it, so it is the third caller of the shared row and
    // the third way this can fork — the tempting shortcut there was
    // <RepairDefectRow>, which drags a tag <select> the API refuses from staff
    // onto a read-only page.
    //
    // This compares the SHARED region (`repair-defect-view`) on both sides
    // rather than whole containers, because the log legitimately adds a strip
    // of its own around it: what the buyer ASKED for, which is the buyer's
    // words and belongs to no other portal. Comparing containers would force
    // the log to drop the one thing it exists to show.
    const Stub = createRoutesStub([
      {
        path: "/agent-repair-items",
        Component: () => (
          <AgentRepairInspectionBlock
            inspectionId="i1"
            tenantName="Acme Inspections"
            tenantSlug="acme"
            repairAccess="readwrite"
            rows={[
              {
                inspectionId: "i1",
                repairAccess: "readwrite",
                sectionTitle: DEFECT.sectionTitle,
                itemLabel: DEFECT.itemLabel,
                defectTitle: DEFECT.defectTitle,
                location: DEFECT.location,
                comment: DEFECT.comment,
                category: DEFECT.category,
                isCustom: false,
                photos: [],
              },
            ]}
            photosFor={() => []}
          />
        ),
      },
    ]);
    const agent = render(<Stub initialEntries={["/agent-repair-items"]} />);

    const staff = render(
      <RepairRequestLogEntry
        list={{
          id: "rr1",
          createdByKind: "client",
          createdByRef: "buyer@example.com",
          customIntro: null,
          createdAtDisplay: "Jul 1",
          creditTotalCents: 0,
          items: [
            {
              id: "it1",
              sectionTitle: DEFECT.sectionTitle,
              itemLabel: DEFECT.itemLabel,
              defectTitle: DEFECT.defectTitle,
              location: DEFECT.location,
              comment: DEFECT.comment,
              category: DEFECT.category,
              note: null,
              requestedCreditCents: null,
              actionTag: null,
            },
          ],
        }}
      />,
    );

    // Wait for the agent route to paint before reading either tree. Both
    // renders share document.body, so the shared region is scoped out of each
    // `container` rather than looked up by testid globally — the testid is the
    // same on both sides, which is the entire point of it.
    await agent.findByTestId("repair-row-i1-0");
    const agentView = agent.container.querySelector<HTMLElement>('[data-testid="repair-defect-view"]');
    const staffView = staff.container.querySelector<HTMLElement>('[data-testid="repair-defect-view"]');
    expect(agentView).not.toBeNull();
    expect(staffView).not.toBeNull();
    expect(readable(staffView!)).toBe(readable(agentView!));
  });
});
