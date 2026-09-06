/**
 * `/library/tags` — the two buttons that did nothing, and the asymmetries
 * behind them.
 *
 * `POST /api/tags`, `PUT /api/tags/{id}` and `DELETE /api/tags/{id}` have all
 * existed since they were written. The page called only `GET`, so "+ Add tag"
 * and every row's "Edit" were `<button>` elements with no `onClick` — the same
 * shape as the two-factor panel, one screen over.
 *
 * The assertions that matter are not "it posts". They are the two server rules
 * a plausible implementation gets wrong, both of which are invisible from the
 * page and only appear when you read `server/api/tags.ts` and
 * `tag.service.ts`:
 *
 *   1. CREATE allows an inspector; UPDATE is owner/manager only. An Edit
 *      control offered to an inspector is a button whose only outcome is 403 —
 *      which is the original defect with a status code attached.
 *   2. `color` is OPTIONAL on create and NULLABLE on update. Those are
 *      different requests: create omits the key, update sends null to clear a
 *      colour that is already set. Sending `color: ''` to either is a 400, and
 *      omitting it on update silently keeps the old colour while the person
 *      watched themselves pick "No color".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const listGet = vi.fn();
const createPost = vi.fn();
const updatePut = vi.fn();
const ctxGet = vi.fn();

vi.mock("~/lib/session.server", () => ({
    getToken: vi.fn(),
    requireToken: vi.fn(async () => "t"),
}));
vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({
        sessionContext: { context: { $get: (...a: unknown[]) => ctxGet(...a) } },
        tags: Object.assign(
            { index: { $get: (...a: unknown[]) => listGet(...a), $post: (...a: unknown[]) => createPost(...a) } },
            { ":id": { $put: (...a: unknown[]) => updatePut(...a) } },
        ),
    })),
}));

import { loader, action } from "./tags";
import { colorOptionsFor, TAG_COLORS } from "~/components/library/TagEditorModal";
import { routeArgs } from "../../../tests/helpers/route-args";

const CONTEXT = {} as Parameters<typeof action>[0]["context"];
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const TAGS = [
    { id: "t1", name: "Safety concern", color: "red", isSeed: true },
    { id: "t2", name: "Mine", color: null, isSeed: false },
];

function asRole(role: string) {
    ctxGet.mockResolvedValue(json({ data: { user: { role } } }));
    return loader(routeArgs(new Request("https://x/library/tags"), { params: {}, context: CONTEXT }));
}

function post(fields: Record<string, string>) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return action(routeArgs(
        new Request("https://x/library/tags", { method: "POST", body: form }),
        { params: {}, context: CONTEXT },
    ));
}

const sentTo = (fn: typeof createPost) => (fn.mock.calls[0]![0] as { json: Record<string, unknown> }).json;

beforeEach(() => {
    vi.clearAllMocks();
    listGet.mockResolvedValue(json({ data: TAGS }));
    createPost.mockResolvedValue(json({ data: TAGS[1] }));
    updatePut.mockResolvedValue(json({ data: TAGS[1] }));
});

describe("who may edit a tag", () => {
    it("CONTROL — an owner is told they may manage, so the negative below means something", async () => {
        const out = await asRole("owner");
        expect(out.canManage).toBe(true);
        expect(out.tags).toHaveLength(2);
    });

    it("an INSPECTOR is not — PUT refuses them, so the page must not offer Edit", async () => {
        expect((await asRole("inspector")).canManage).toBe(false);
    });

    it("a failed list does not also downgrade what the caller may do", async () => {
        // The role was resolved before the list request. Answering `canManage:
        // false` here would read as "you are not allowed" when the truth is
        // "we could not load this".
        listGet.mockResolvedValue(json({ error: "boom" }, 500));
        const out = await asRole("owner");
        expect(out.loadFailed).toBe(true);
        expect(out.canManage).toBe(true);
    });

    it("carries isSeed through, because a starter tag cannot be renamed", async () => {
        const out = await asRole("owner");
        expect(out.tags.find((t) => t.id === "t1")?.isSeed).toBe(true);
    });
});

describe("what the form sends", () => {
    it("CREATE omits color entirely when none was chosen", async () => {
        // `CreateTagSchema` is `.strict()` and `color` is optional with a
        // `/^[a-z]{3,20}$/` pattern — an empty string is a 400, not a default.
        await post({ name: "New tag", color: "" });
        expect(createPost).toHaveBeenCalledTimes(1);
        expect(sentTo(createPost)).toEqual({ name: "New tag" });
    });

    it("CREATE includes a chosen color", async () => {
        await post({ name: "New tag", color: "blue" });
        expect(sentTo(createPost)).toEqual({ name: "New tag", color: "blue" });
    });

    it("UPDATE sends null to clear a colour, not an empty string and not nothing", async () => {
        // Omitting the key would silently keep the old colour while the person
        // watched themselves pick "No color" — the failure mode this whole page
        // is being fixed for, one field down.
        await post({ id: "t2", name: "Mine", color: "" });
        expect(updatePut).toHaveBeenCalledTimes(1);
        const call = updatePut.mock.calls[0]![0] as { param: { id: string }; json: Record<string, unknown> };
        expect(call.param).toEqual({ id: "t2" });
        expect(call.json).toEqual({ name: "Mine", color: null });
    });

    it("routes to CREATE when there is no id, and to UPDATE when there is", async () => {
        await post({ name: "A", color: "red" });
        expect(createPost).toHaveBeenCalledTimes(1);
        expect(updatePut).not.toHaveBeenCalled();
    });

    it("reports the API's own refusal — a name clash is worth reading", async () => {
        createPost.mockResolvedValue(json({ error: { message: "A tag named 'Mine' already exists" } }, 409));
        const out = await post({ name: "Mine", color: "" });
        expect(out).toEqual({ ok: false, error: "A tag named 'Mine' already exists" });
    });

    it("NEGATIVE CONTROL — a rejected save is not reported as success", async () => {
        updatePut.mockResolvedValue(json({ error: "Seed tags cannot be renamed" }, 403));
        const out = await post({ id: "t1", name: "Renamed", color: "red" });
        expect(out.ok).toBe(false);
    });
});

describe("the colour list can represent what is already stored", () => {
    it("CONTROL — a known colour does not grow the list", () => {
        expect(colorOptionsFor("red")).toEqual(TAG_COLORS);
        expect(colorOptionsFor(null)).toEqual(TAG_COLORS);
    });

    it("keeps a token the list does not know, so opening the dialog cannot erase it", () => {
        // Real data: `rose`, `emerald` and `amber` are Tailwind palette names,
        // not CSS colour keywords. They pass the server's /^[a-z]{3,20}$/ and
        // paint nothing in the list — and a select that cannot represent them
        // would show "No color" for a tag that has one, then save that.
        for (const stored of ["rose", "emerald", "amber"]) {
            const opts = colorOptionsFor(stored);
            expect(opts).toContain(stored);
            expect(opts[0]).toBe(stored);
            expect(opts).toHaveLength(TAG_COLORS.length + 1);
        }
    });
});
