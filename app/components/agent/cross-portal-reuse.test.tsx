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
  estimateLow: null,
  estimateHigh: null,
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
        onToggle={() => {}}
        onUpdateCredit={() => {}}
        onUpdateNote={() => {}}
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
});
