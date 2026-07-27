/**
 * IA-57 — the two string-keyed seams between the builder and the API.
 *
 * The trade travels from the builder to the database as a FormData key: the
 * builder writes `fd.append("trade", ...)`, the route action reads
 * `form.get("trade")` and forwards it as JSON. Nothing type-checks that pair —
 * a rename on one side leaves a page that still renders, still saves, and
 * silently drops the field. These two tests pin the seam from both ends.
 */
import { describe, it, expect, vi } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import {
  RepairBuilderSection,
  type Defect,
} from "~/components/portal/sections/RepairBuilderSection";

const DEFECT: Defect = {
  findingKey: "canned:s1:i1:roof",
  sectionId: "s1",
  sectionTitle: "Roof",
  itemId: "i1",
  itemLabel: "Shingles",
  defectTitle: "Missing shingles",
  location: "North slope",
  comment: "Replace missing shingles.",
  category: "safety",
  severityBucket: "defect",
  trade: "licensed roofer",
  estimateLow: null,
  estimateHigh: null,
};

describe("builder → action seam", () => {
  it("puts the defect's trade in the add-item form data when selected", async () => {
    const submissions: FormData[] = [];
    const Stub = createRoutesStub([
      {
        path: "/repair-builder/t1/insp1",
        Component: () => (
          <RepairBuilderSection
            result={{
              kind: "ok",
              defects: [DEFECT],
              mine: [],
              tenant: "t1",
              id: "insp1",
              token: "tok",
            }}
            actionPath="/repair-builder/t1/insp1"
          />
        ),
        action: async ({ request }) => {
          const fd = await request.formData();
          submissions.push(fd);
          return { ok: true, data: { id: "rr-1", findingKey: DEFECT.findingKey } };
        },
      },
    ]);

    const { findByText } = render(
      <Stub initialEntries={["/repair-builder/t1/insp1"]} />,
    );
    fireEvent.click(await findByText("Missing shingles"));

    await waitFor(() => {
      const add = submissions.find((fd) => fd.get("_intent") === "add-item");
      expect(add).toBeDefined();
      expect(add!.get("trade")).toBe("licensed roofer");
    });
  });
});

describe("action → API seam", () => {
  it("forwards the trade form field into the add-item request body", async () => {
    const post = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "item-1" } }),
    });
    vi.doMock("~/lib/api-client.server", () => ({
      createApi: () => ({
        repairBuilder: {
          "repair-builder": {
            ":tenant": {
              ":id": { lists: { ":rrId": { items: { $post: post } } } },
            },
          },
        },
      }),
    }));
    vi.doMock("~/lib/session.server", () => ({ getToken: async () => null }));

    const { action } = await import("./repair-builder.$tenant.$id");

    const fd = new FormData();
    fd.append("_intent", "add-item");
    fd.append("rrId", "rr1");
    fd.append("findingKey", "canned:s1:i1:roof");
    fd.append("sectionTitle", "Roof");
    fd.append("itemLabel", "Shingles");
    fd.append("trade", "licensed roofer");

    await action({
      params: { tenant: "t1", id: "insp1" },
      request: new Request("https://x/repair-builder/t1/insp1", {
        method: "POST",
        body: fd,
      }),
      context: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({ trade: "licensed roofer" }),
      }),
    );

    vi.doUnmock("~/lib/api-client.server");
    vi.doUnmock("~/lib/session.server");
  });
});
