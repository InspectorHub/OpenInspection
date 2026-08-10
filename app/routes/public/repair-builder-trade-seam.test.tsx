// @vitest-environment happy-dom
/**
 * IA-57 — the two string-keyed seams between the builder and the API.
 *
 * The trade travels from the builder to the database as a FormData key: the
 * builder writes `fd.append("trade", ...)`, the route action reads
 * `form.get("trade")` and forwards it as JSON. Nothing type-checks that pair —
 * a rename on one side leaves a page that still renders, still saves, and
 * silently drops the field. These two tests pin the seam from both ends.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import {
  RepairBuilderSection,
  type Defect,
} from "~/components/portal/sections/RepairBuilderSection";

/**
 * Why the route import and its mocks sit at module scope rather than inside the
 * second `it()` (#88/#89).
 *
 * Loading a route MODULE from inside a test body bills that module's ENTIRE
 * import graph against the 5000 ms default `testTimeout`. The graph here reaches
 * `~/paraglide/messages`, ~3.7 MB of generated source that Vite transforms on
 * the ONE main thread every test worker shares, so the cost is queueing behind
 * ~440 other source files rather than compute. Measured on this graph with a
 * probe under `--maxWorkers=16`: 3702 ms, and an outright timeout on three runs
 * out of three when the suite was busier. A static import pays the same cost
 * during COLLECTION, which has no per-test budget, so it is never the victim.
 *
 * This file was partly shielded by accident: the `RepairBuilderSection` import
 * above is static and already drags the paraglide graph in, leaving the dynamic
 * route import measuring only 25 ms. That shield is one test deep — it lasts
 * exactly as long as the render test above it. The hoist makes it structural
 * instead, and matches `repair-builder-action-tag-seam.test.tsx`.
 *
 * `~/paraglide/messages` is deliberately NOT stubbed here, unlike in that
 * sibling: the first test renders `RepairBuilderSection`, whose visible copy is
 * messages, so a stub would change what the render asserts. (It would also be
 * inert — the static import above resolves before any `doMock` runs.)
 */
const post = vi.fn();

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let builderAction: (args: any) => Promise<unknown>;

beforeAll(async () => {
  builderAction = (await import("./repair-builder.$tenant.$id")).action;
});

beforeEach(() => {
  post.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { id: "item-1" } }),
  });
});

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
              quickPhrases: null,
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
    const fd = new FormData();
    fd.append("_intent", "add-item");
    fd.append("rrId", "rr1");
    fd.append("findingKey", "canned:s1:i1:roof");
    fd.append("sectionTitle", "Roof");
    fd.append("itemLabel", "Shingles");
    fd.append("trade", "licensed roofer");

    await builderAction({
      params: { tenant: "t1", id: "insp1" },
      request: new Request("https://x/repair-builder/t1/insp1", {
        method: "POST",
        body: fd,
      }),
      context: {},
    });

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({ trade: "licensed roofer" }),
      }),
    );
  });
});
