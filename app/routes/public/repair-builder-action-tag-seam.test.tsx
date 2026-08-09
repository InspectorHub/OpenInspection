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
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

/**
 * Why the mocks and the route imports are hoisted to module scope (#88).
 *
 * These specs reach the route actions through a dynamic `import()` of the route
 * MODULE, so whoever runs first pays for that module's entire import graph —
 * and the graph reaches `~/paraglide/messages`, which is ~3.7 MB of generated
 * source re-exporting a ~1.3 MB bundle per locale. Vite transforms that on the
 * ONE main thread every test worker shares, so under a loaded suite the cost is
 * queueing behind other workers, not compute. Two things then made it fatal:
 * the wait landed inside an `it()`, where it is billed against the 5 s default
 * test timeout, and an `afterEach(vi.resetModules)` made all five tests re-walk
 * the graph instead of one.
 *
 * Measured here: the first test took 3.6 s alone, and crossed 5 s whenever the
 * rest of the suite competed for the transform server — a red test for reasons
 * with nothing to do with what it asserts. It read as a flake because the victim
 * moved: whichever spec demands the transform first while the workers are all
 * starting is the one that draws the short straw.
 *
 * So the graph is loaded ONCE, in `beforeAll`, where loading a fixture belongs
 * and where the budget is the hook timeout rather than a test's. That is only
 * possible because the mocks below are module-scoped and merely re-armed
 * between tests, so no test needs its own module registry.
 *
 * `m` is stubbed for the same reason: nothing on an action path reads a message.
 * It is touched by `meta()` and by section JSX, neither of which these specs
 * render, so the biggest thing in the graph is also the least relevant one.
 */
vi.doMock("~/paraglide/messages", () => ({
  m: new Proxy({} as Record<string, () => string>, {
    get: (_target, key) => () => String(key),
  }),
}));

const post = vi.fn();
const patch = vi.fn();
const source = vi.fn();

/** The one defect the agent bulk-add fans out into an add-item call. */
const SOURCE_PAYLOAD = {
  defects: [
    {
      findingKey: "canned:s1:i1:roof",
      sectionTitle: "Roof",
      itemLabel: "Shingles",
      defectTitle: "Missing shingles",
      location: "North slope",
      category: "safety",
      comment: "Replace missing shingles.",
      trade: "licensed roofer",
    },
  ],
  mine: [{ id: "rr1", shareToken: "tok", createdAt: 1, expiresAt: null, revokedAt: null, items: [] }],
};

// One client shape serves both routes: the builder action writes through
// `lists`, and the agent bulk-add reads `source` first before writing the same
// way. Keeping them on one mock is what lets both modules load from one hook.
vi.doMock("~/lib/api-client.server", () => ({
  createApi: () => ({
    repairBuilder: {
      "repair-builder": {
        ":tenant": {
          ":id": {
            source: { $get: source },
            lists: { ":rrId": { items: { $post: post, ":itemId": { $patch: patch } } } },
          },
        },
      },
    },
  }),
}));

// The builder route reads `getToken` (public token track); the agent route
// reads `requireToken` (account track). Both live in this one module.
vi.doMock("~/lib/session.server", () => ({
  getToken: async () => null,
  requireToken: async () => "t",
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteAction = (args: any) => Promise<unknown>;

let builderAction: RouteAction;
let agentAction: RouteAction;

beforeAll(async () => {
  builderAction = (await import("./repair-builder.$tenant.$id")).action;
  agentAction = (await import("../agent/repair-items")).action;
});

beforeEach(() => {
  post.mockReset().mockResolvedValue({ ok: true, json: async () => ({ data: { id: "item-1" } }) });
  patch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
  source.mockReset().mockResolvedValue({ ok: true, json: async () => ({ data: SOURCE_PAYLOAD }) });
});

async function runBuilderAction(fd: FormData) {
  await builderAction({
    params: { tenant: "t1", id: "insp1" },
    request: new Request("https://x/repair-builder/t1/insp1", { method: "POST", body: fd }),
    context: {},
  });
}

describe("client write path — add-item branch", () => {
  it("forwards the repairActionTag form field into the add-item body", async () => {
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
    const fd = new FormData();
    fd.append("_intent", "share");
    fd.append("inspectionId", "insp1");
    fd.append("tenantSlug", "t1");

    await agentAction({
      request: new Request("https://x/agent/repair-items", { method: "POST", body: fd }),
      context: {},
    });

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({ trade: "licensed roofer", repairActionTag: null }),
      }),
    );
  });
});
