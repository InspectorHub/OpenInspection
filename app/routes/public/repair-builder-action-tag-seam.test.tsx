// @vitest-environment happy-dom
/**
 * #275 — the string-keyed seams that carry the action tag from a form to the API.
 *
 * `form.get("repairActionTag")` on one side, `fd.append("repairActionTag", …)` on
 * the other, and nothing type-checks the pair: a field the route does not parse
 * is written as null on that path while the page still renders and still saves.
 *
 * The builder route action has TWO branches that must each read the key —
 * add-item and update-item — and the agent bulk-add posts a third, entirely
 * separate explicit field list. Three seams, three tests. The trade assertion in
 * the agent test is not incidental: `trade` was missing from that list from
 * IA-57 until #275, so every agent-forwarded list had a null trade snapshot.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

/** Captures the add-item POST body from the in-process API client. */
function mockBuilderApi() {
  const post = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: "item-1" } }) });
  const patch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.doMock("~/lib/api-client.server", () => ({
    createApi: () => ({
      repairBuilder: {
        "repair-builder": {
          ":tenant": {
            ":id": { lists: { ":rrId": { items: { $post: post, ":itemId": { $patch: patch } } } } },
          },
        },
      },
    }),
  }));
  vi.doMock("~/lib/session.server", () => ({ getToken: async () => null }));
  return { post, patch };
}

async function runBuilderAction(fd: FormData) {
  const { action } = await import("./repair-builder.$tenant.$id");
  await action({
    params: { tenant: "t1", id: "insp1" },
    request: new Request("https://x/repair-builder/t1/insp1", { method: "POST", body: fd }),
    context: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

afterEach(() => {
  vi.doUnmock("~/lib/api-client.server");
  vi.doUnmock("~/lib/session.server");
  vi.resetModules();
});

describe("client write path — add-item branch", () => {
  it("forwards the repairActionTag form field into the add-item body", async () => {
    const { post } = mockBuilderApi();
    const fd = new FormData();
    fd.append("_intent", "add-item");
    fd.append("rrId", "rr1");
    fd.append("findingKey", "canned:s1:i1:roof");
    fd.append("sectionTitle", "Roof");
    fd.append("itemLabel", "Shingles");
    fd.append("repairActionTag", "replace");

    await runBuilderAction(fd);

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ json: expect.objectContaining({ repairActionTag: "replace" }) }),
    );
  });

  it("sends null when the key is absent, and refuses a value outside the vocabulary", async () => {
    const { post } = mockBuilderApi();
    const fd = new FormData();
    fd.append("_intent", "add-item");
    fd.append("rrId", "rr1");
    fd.append("findingKey", "canned:s1:i1:roof");
    fd.append("sectionTitle", "Roof");
    fd.append("itemLabel", "Shingles");
    fd.append("repairActionTag", "further_study"); // cost_items' vocabulary, not ours

    await runBuilderAction(fd);

    // Parsed against the one shared list, so a stray value becomes "untagged"
    // rather than a 400 the client cannot explain.
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ json: expect.objectContaining({ repairActionTag: null }) }),
    );
  });
});

describe("client write path — update-item branch", () => {
  it("forwards the tag into the patch", async () => {
    const { patch } = mockBuilderApi();
    const fd = new FormData();
    fd.append("_intent", "update-item");
    fd.append("rrId", "rr1");
    fd.append("itemId", "item1");
    fd.append("repairActionTag", "fund");

    await runBuilderAction(fd);

    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({ json: expect.objectContaining({ repairActionTag: "fund" }) }),
    );
  });

  it("omits the key entirely when the form did not carry it", async () => {
    // A note-only or credit-only submit must not clear a tag the buyer set.
    const { patch } = mockBuilderApi();
    const fd = new FormData();
    fd.append("_intent", "update-item");
    fd.append("rrId", "rr1");
    fd.append("itemId", "item1");
    fd.append("note", "just the note");

    await runBuilderAction(fd);

    const body = (patch.mock.calls[0]?.[0] as { json: Record<string, unknown> }).json;
    expect("repairActionTag" in body).toBe(false);
  });
});

describe("agent bulk-add — the third, separate field list", () => {
  it("forwards trade AND an explicit null tag for every defect", async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: "item-1" } }) });
    const source = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          defects: [{
            findingKey: "canned:s1:i1:roof",
            sectionTitle: "Roof",
            itemLabel: "Shingles",
            defectTitle: "Missing shingles",
            location: "North slope",
            category: "safety",
            comment: "Replace missing shingles.",
            trade: "licensed roofer",
          }],
          mine: [{ id: "rr1", shareToken: "tok", createdAt: 1, expiresAt: null, revokedAt: null, items: [] }],
        },
      }),
    });
    vi.doMock("~/lib/api-client.server", () => ({
      createApi: () => ({
        repairBuilder: {
          "repair-builder": {
            ":tenant": {
              ":id": { source: { $get: source }, lists: { ":rrId": { items: { $post: post } } } },
            },
          },
        },
      }),
    }));
    vi.doMock("~/lib/session.server", () => ({ requireToken: async () => "t" }));

    const { action } = await import("../agent/repair-items");
    const fd = new FormData();
    fd.append("_intent", "share");
    fd.append("inspectionId", "insp1");
    fd.append("tenantSlug", "t1");
    await action({
      request: new Request("https://x/agent/repair-items", { method: "POST", body: fd }),
      context: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({ trade: "licensed roofer", repairActionTag: null }),
      }),
    );
  });
});
