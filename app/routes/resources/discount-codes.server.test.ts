/**
 * Editing a discount code — units, and what a toggle must NOT carry.
 *
 * `PUT /api/services/discount-codes/{id}` has existed since it was written and
 * the panel called nothing, so every row's Edit was a `<button>` with no
 * `onClick`: a code could be created and then never corrected or switched off.
 *
 * Two things here are money, which is why they are pinned rather than trusted:
 *
 *   1. `value` is an integer whose MEANING depends on `type` — a whole
 *      percentage for `percent`, CENTS for `fixed` (the panel renders fixed
 *      codes as `value / 100`). A form that forwarded typed dollars would turn
 *      a $50 discount into $0.50 and report success.
 *   2. a toggle sends ONLY `active`. Sending the whole form would let a stale
 *      value field ride along, so re-enabling a code could change its amount as
 *      a side effect — and the person would have no reason to look.
 *
 * `maxUses` and `expiresAt` are nullable on update, so blank means "no limit" /
 * "never" and has to be sent as null; omitting the key keeps the old value
 * while the person watched themselves clear the field.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const put = vi.fn();

vi.mock("~/lib/session.server", () => ({
    getToken: vi.fn(),
    requireToken: vi.fn(async () => "t"),
}));
vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({
        services: { "discount-codes": { ":id": { $put: (...a: unknown[]) => put(...a) } } },
    })),
}));

import { action, toStoredValue } from "./discount-codes";
import { routeArgs } from "../../../tests/helpers/route-args";

const CONTEXT = {} as Parameters<typeof action>[0]["context"];
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function post(fields: Record<string, string>) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return action(routeArgs(
        new Request("https://x/resources/discount-codes", { method: "POST", body: form }),
        { params: {}, context: CONTEXT },
    ));
}

const sent = () => (put.mock.calls[0]![0] as { param: { id: string }; json: Record<string, unknown> });

const FULL = { id: "d1", code: "SPRING", type: "fixed", value: "50", maxUses: "", expiresAt: "", active: "true" };

beforeEach(() => {
    vi.clearAllMocks();
    put.mockResolvedValue(json({ data: { id: "d1" } }));
});

describe("dollars in, cents out", () => {
    it("CONTROL — the conversion is not the identity, so the cases below mean something", () => {
        expect(toStoredValue("fixed", "50")).toBe(5000);
        expect(toStoredValue("percent", "50")).toBe(50);
    });

    it("$49.99 becomes 4999", () => {
        expect(toStoredValue("fixed", "49.99")).toBe(4999);
    });

    it("rounds rather than truncates — a third decimal must not lose a cent", () => {
        // Math.trunc would make this 1234 and quietly discount less than the
        // screen said.
        expect(toStoredValue("fixed", "12.345")).toBe(1235);
    });

    it("refuses a fractional percent, which the server stores as an integer", () => {
        expect(toStoredValue("percent", "12.5")).toBeNull();
    });

    it("refuses nonsense and negatives rather than sending NaN", () => {
        expect(toStoredValue("fixed", "")).toBeNull();
        expect(toStoredValue("fixed", "abc")).toBeNull();
        expect(toStoredValue("fixed", "-5")).toBeNull();
    });

    it("a fixed save reaches the API in cents", async () => {
        await post(FULL);
        expect(sent().param).toEqual({ id: "d1" });
        expect(sent().json.value).toBe(5000);
    });

    it("a percent save reaches the API untouched", async () => {
        await post({ ...FULL, type: "percent", value: "15" });
        expect(sent().json).toMatchObject({ type: "percent", value: 15 });
    });
});

describe("clearing a limit, and the toggle", () => {
    it("blank maxUses and expiresAt are sent as NULL, not omitted", async () => {
        await post(FULL);
        expect(sent().json.maxUses).toBeNull();
        expect(sent().json.expiresAt).toBeNull();
    });

    it("a set limit and date are sent as given", async () => {
        await post({ ...FULL, maxUses: "25", expiresAt: "2026-12-31" });
        expect(sent().json).toMatchObject({ maxUses: 25, expiresAt: "2026-12-31" });
    });

    it("an unticked box means false — the absent key is the OFF signal", async () => {
        // The editor sends no `active` entry when the box is clear. A hidden
        // `value="false"` mirror beside the checkbox would have won on
        // `FormData.get()` and inverted this.
        const { active, ...withoutActive } = FULL;
        void active;
        await post(withoutActive);
        expect(sent().json.active).toBe(false);
    });

    it("a TOGGLE sends only `active` — no value, no code", async () => {
        await post({ intent: "toggle", id: "d1", active: "false" });
        expect(sent().json).toEqual({ active: false });
        expect(sent().json).not.toHaveProperty("value");
        expect(sent().json).not.toHaveProperty("code");
    });
});

describe("refusals", () => {
    it("rejects a bad amount without calling the API", async () => {
        const out = await post({ ...FULL, value: "abc" });
        expect(put).not.toHaveBeenCalled();
        expect(out.ok).toBe(false);
    });

    it("rejects a missing id", async () => {
        const out = await post({ ...FULL, id: "" });
        expect(put).not.toHaveBeenCalled();
        expect(out).toMatchObject({ ok: false });
    });

    it("rejects an unknown type rather than guessing the units", async () => {
        const out = await post({ ...FULL, type: "sometimes" });
        expect(put).not.toHaveBeenCalled();
        expect(out.ok).toBe(false);
    });

    it("NEGATIVE CONTROL — the API's refusal is reported, not swallowed", async () => {
        put.mockResolvedValue(json({ error: { message: "Code already in use" } }, 409));
        const out = await post(FULL);
        expect(out).toEqual({ ok: false, error: "Code already in use" });
    });
});
