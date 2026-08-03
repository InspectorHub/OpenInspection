// @vitest-environment happy-dom
/**
 * The agent repair-items page groups by PROPERTY / transaction, not by defect
 * category — the same first-level structure the agent dashboard uses. An agent's
 * unit of work is the deal, so the address is the heading and the inspection
 * company is inline metadata. Within a property, each inspection is its own
 * block: delivery (share link / email) is strictly per-inspection, so the block
 * is the thing an action can attach to.
 *
 * Pattern: createRoutesStub, mirroring app/routes/agent/dashboard.test.tsx.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import AgentRepairItemsPage, { pickLiveShareToken } from "~/routes/agent/repair-items";

interface Row {
  inspectionId: string;
  tenantName: string;
  tenantSlug: string;
  repairAccess: "off" | "read" | "readwrite";
  propertyAddress: string | null;
  inspectionDate: string | null;
  sectionTitle: string;
  itemLabel: string;
  defectTitle: string;
  location: string | null;
  comment: string | null;
  category: string;
  isCustom: boolean;
  photos: string[];
}

const BASE: Row = {
  inspectionId: "i1",
  tenantName: "Acme Inspections",
  tenantSlug: "acme",
  repairAccess: "readwrite",
  propertyAddress: "123 Main St",
  inspectionDate: "2026-07-18",
  sectionTitle: "Roof",
  itemLabel: "Shingles",
  defectTitle: "Missing shingles",
  location: "North slope",
  comment: "Replace missing shingles.",
  category: "safety",
  isCustom: false,
  photos: [],
};

function renderPage(items: Row[], onAction?: (form: FormData) => unknown) {
  const Stub = createRoutesStub([
    {
      path: "/agent-repair-items",
      Component: AgentRepairItemsPage,
      loader: () => ({ items }),
      action: async ({ request }) => (onAction ? onAction(await request.formData()) : null),
    },
  ]);
  return render(<Stub initialEntries={["/agent-repair-items"]} />);
}

describe("AgentRepairItemsPage property grouping", () => {
  it("renders one property section per address, with each inspection as its own block", async () => {
    const { findByTestId, getAllByText } = renderPage([
      { ...BASE, inspectionId: "i1", tenantName: "Acme Inspections" },
      // Same property, different company + casing/whitespace — one section, two blocks.
      { ...BASE, inspectionId: "i2", tenantName: "Best Inspect", propertyAddress: "123  main st ", defectTitle: "Cracked flashing", inspectionDate: "2026-07-12" },
      { ...BASE, inspectionId: "i3", propertyAddress: "456 Oak Ave", defectTitle: "Loose rail", inspectionDate: "2026-07-01" },
    ]);

    const b1 = await findByTestId("repair-inspection-i1");
    const b2 = await findByTestId("repair-inspection-i2");
    const b3 = await findByTestId("repair-inspection-i3");

    // The shared address heads one section only (not once per company).
    expect(getAllByText("123 Main St")).toHaveLength(1);

    // Company name is inline block metadata, not the section heading.
    expect(b1.textContent).toContain("Acme Inspections");
    expect(b2.textContent).toContain("Best Inspect");

    // Items nest under their own inspection block.
    expect(b1.textContent).toContain("Missing shingles");
    expect(b1.textContent).not.toContain("Cracked flashing");
    expect(b2.textContent).toContain("Cracked flashing");
    expect(b3.textContent).toContain("Loose rail");
  });

  it("sorts property sections by most recent inspection date", async () => {
    const { findByTestId } = renderPage([
      { ...BASE, inspectionId: "old", propertyAddress: "1 Old Rd", inspectionDate: "2026-01-01" },
      { ...BASE, inspectionId: "new", propertyAddress: "2 New Rd", inspectionDate: "2026-07-20" },
    ]);
    const newer = await findByTestId("repair-inspection-new");
    const older = await findByTestId("repair-inspection-old");
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps addressless inspections in their own section rather than merging them", async () => {
    const { findByTestId } = renderPage([
      { ...BASE, inspectionId: "a", propertyAddress: null },
      { ...BASE, inspectionId: "b", propertyAddress: null },
    ]);
    expect(await findByTestId("repair-inspection-a")).toBeTruthy();
    expect(await findByTestId("repair-inspection-b")).toBeTruthy();
  });

  it("renders an empty state when the agent has no repair items", async () => {
    const { findByText } = renderPage([]);
    expect(await findByText(/no repair items/i)).toBeTruthy();
  });
});

describe("AgentRepairItemsPage renders the shared client row", () => {
  it("shows the item label and the defect photos the API already returns", async () => {
    const { findByTestId } = renderPage([
      {
        ...BASE,
        inspectionId: "i1",
        photos: ["t/inspections/i1/photos/a.jpg", "t/inspections/i1/photos/b.jpg"],
      },
    ]);

    const block = await findByTestId("repair-inspection-i1");
    // itemLabel reaches the screen (it was in the payload but never rendered).
    expect(block.textContent).toContain("Shingles");

    const imgs = block.querySelectorAll("img");
    expect(imgs).toHaveLength(2);
    // Photos resolve through the AGENT auth path — never the client cookie or
    // portal-token photo routes, which reject an agent session.
    expect(imgs[0].getAttribute("src")).toContain("/api/agent/inspections/i1/photo");
    expect(imgs[0].getAttribute("src")).toContain(encodeURIComponent("t/inspections/i1/photos/a.jpg"));
  });

  it("shows no credit input — the agent view is read-only", async () => {
    const { findByTestId } = renderPage([{ ...BASE, inspectionId: "i1" }]);
    const block = await findByTestId("repair-inspection-i1");
    // The defect rows carry no credit/note inputs. (The share form below the
    // block is a separate affordance and lives outside the rows.)
    const rows = block.querySelectorAll("[data-testid^='repair-row-']");
    for (const row of rows) {
      expect(row.querySelectorAll("input, textarea")).toHaveLength(0);
    }
  });
});

describe("AgentRepairItemsPage delivery outlet", () => {
  it("shares the list for THAT inspection — one share action per inspection block", async () => {
    const submissions: FormData[] = [];
    const { findByTestId } = renderPage(
      [
        { ...BASE, inspectionId: "i1", tenantSlug: "acme" },
        { ...BASE, inspectionId: "i2", tenantSlug: "best", propertyAddress: "456 Oak Ave" },
      ],
      (form) => {
        submissions.push(form);
        return { ok: true, inspectionId: String(form.get("inspectionId")), shareToken: "tok-1" };
      },
    );

    const block = await findByTestId("repair-inspection-i2");
    fireEvent.click(block.querySelector("[data-testid='repair-share-i2']")!);

    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0].get("_intent")).toBe("share");
    // Scoped to that block's inspection + its owning company, never an
    // aggregate across properties (the share channel is per-inspection).
    expect(submissions[0].get("inspectionId")).toBe("i2");
    expect(submissions[0].get("tenantSlug")).toBe("best");
  });

  it("reveals the shared client share panel once the action returns a token", async () => {
    const { findByTestId } = renderPage(
      [{ ...BASE, inspectionId: "i1" }],
      (form) => ({ ok: true, inspectionId: String(form.get("inspectionId")), shareToken: "tok-1" }),
    );

    const block = await findByTestId("repair-inspection-i1");
    fireEvent.click(block.querySelector("[data-testid='repair-share-i1']")!);

    // The same panel the client repair builder uses — copy link, PDF, and the
    // email form — rather than a second agent-only share UI.
    await waitFor(() => {
      expect(document.body.textContent).toContain("Copy share link");
    });
    expect(document.querySelector("input[type='email']")).toBeTruthy();
    // The trigger is gone: one live link per inspection, not a mint button that
    // keeps minting.
    expect(document.querySelector("[data-testid='repair-share-i1']")).toBeNull();
  });

  it("keeps print as a secondary outlet", async () => {
    const { findByText } = renderPage([{ ...BASE }]);
    expect(await findByText(/print/i)).toBeTruthy();
  });

  it("offers no share action when the company forbids agents from building lists", async () => {
    // The share action creates a repair_requests row, which read-only and off
    // both refuse server-side — offering the button would only produce a 403.
    const { findByTestId } = renderPage([{ ...BASE, inspectionId: "i1", repairAccess: "read" }]);
    const block = await findByTestId("repair-inspection-i1");
    expect(block.querySelector("[data-testid='repair-share-i1']")).toBeNull();
    // The items themselves are still readable.
    expect(block.textContent).toContain("Missing shingles");
  });
});

describe("pickLiveShareToken", () => {
  const now = 1_800_000_000_000;
  it("reuses the newest live list so a second share does not mint a second link", () => {
    const picked = pickLiveShareToken(
      [
        { shareToken: "old", createdAt: now - 20_000, expiresAt: null, revokedAt: null, items: [] },
        { shareToken: "new", createdAt: now - 10_000, expiresAt: null, revokedAt: null, items: [] },
      ],
      now,
    );
    expect(picked?.shareToken).toBe("new");
  });

  it("ignores an expired or revoked list — its link is already dead", () => {
    expect(
      pickLiveShareToken([{ shareToken: "a", createdAt: now, expiresAt: now - 1, revokedAt: null, items: [] }], now),
    ).toBeNull();
    expect(
      pickLiveShareToken([{ shareToken: "b", createdAt: now, expiresAt: null, revokedAt: now - 1, items: [] }], now),
    ).toBeNull();
  });

  it("returns null when the agent has no list yet", () => {
    expect(pickLiveShareToken([], now)).toBeNull();
  });
});
