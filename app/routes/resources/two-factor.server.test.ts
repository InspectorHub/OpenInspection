/**
 * What the two-factor panel sends, and what it hands back.
 *
 * The panel's Enable / Regenerate / Disable were `<button>` elements with no
 * `onClick` while all five TOTP endpoints existed, so nothing in the product
 * had ever called one. That means there was no wrong request to find — there
 * were no requests. These assertions pin the four the panel now makes.
 *
 * The bodies matter more than usual here: `/2fa/disable` and
 * `/2fa/recovery-codes/regenerate` require BOTH the current password and a
 * current code, so a form that sent one of them would produce a rejection the
 * user would read as "my code is wrong".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const setupPost = vi.fn();
const verifyPost = vi.fn();
const disablePost = vi.fn();
const regenPost = vi.fn();

vi.mock("~/lib/session.server", () => ({
    getToken: vi.fn(),
    requireToken: vi.fn(async () => "t"),
}));
vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({
        auth: {
            "2fa": {
                setup: { $post: (...a: unknown[]) => setupPost(...a) },
                verify: { $post: (...a: unknown[]) => verifyPost(...a) },
                disable: { $post: (...a: unknown[]) => disablePost(...a) },
                "recovery-codes": { regenerate: { $post: (...a: unknown[]) => regenPost(...a) } },
            },
        },
    })),
}));

import { action } from "./two-factor";
import { routeArgs } from "../../../tests/helpers/route-args";

const CONTEXT = {} as Parameters<typeof action>[0]["context"];
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const SETUP = { secret: "JBSWY3DPEHPK3PXP", qrCodeDataUri: "data:image/png;base64,x", recoveryCodes: ["AAAA-BBBB", "CCCC-DDDD"] };

function post(fields: Record<string, string>) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return action(routeArgs(
        new Request("https://x/resources/two-factor", { method: "POST", body: form }),
        { params: {}, context: CONTEXT },
    ));
}

beforeEach(() => {
    vi.clearAllMocks();
    setupPost.mockResolvedValue(json({ data: SETUP }));
    verifyPost.mockResolvedValue(json({ success: true }));
    disablePost.mockResolvedValue(json({ success: true }));
    regenPost.mockResolvedValue(json({ data: SETUP }));
});

describe("the two-factor resource route", () => {
    it("CONTROL — an unknown intent calls nothing", async () => {
        // Without this, "setup called the setup endpoint" is also satisfied by
        // a route that calls every endpoint on every request.
        const out = await post({ intent: "nonsense" });
        expect(setupPost).not.toHaveBeenCalled();
        expect(verifyPost).not.toHaveBeenCalled();
        expect(disablePost).not.toHaveBeenCalled();
        expect(regenPost).not.toHaveBeenCalled();
        expect(out).toMatchObject({ ok: false });
    });

    it("setup returns the secret and the codes, which exist only in this reply", async () => {
        const out = await post({ intent: "setup" });
        expect(setupPost).toHaveBeenCalledTimes(1);
        expect(out).toMatchObject({ ok: true, setup: SETUP });
    });

    it("verify sends only the code", async () => {
        await post({ intent: "verify", code: "123456" });
        expect((verifyPost.mock.calls[0][0] as { json: unknown }).json).toEqual({ code: "123456" });
    });

    it("disable sends BOTH the password and the code", async () => {
        await post({ intent: "disable", password: "pw", code: "123456" });
        expect((disablePost.mock.calls[0][0] as { json: unknown }).json)
            .toEqual({ password: "pw", code: "123456" });
    });

    it("regenerate sends both, and returns a fresh set of codes", async () => {
        const out = await post({ intent: "regenerate", password: "pw", code: "123456" });
        expect((regenPost.mock.calls[0][0] as { json: unknown }).json)
            .toEqual({ password: "pw", code: "123456" });
        expect(out).toMatchObject({ ok: true, setup: SETUP });
    });

    it("trims the code, because a pasted one carries whitespace", async () => {
        await post({ intent: "verify", code: "  123456 " });
        expect((verifyPost.mock.calls[0][0] as { json: { code: string } }).json.code).toBe("123456");
    });

    it("reports the API's own refusal rather than a generic failure", async () => {
        // "Invalid verification code" and "Connection error" call for different
        // actions from the person reading them.
        verifyPost.mockResolvedValue(json({ error: { message: "Invalid verification code" } }, 400));
        const out = await post({ intent: "verify", code: "000000" });
        expect(out).toMatchObject({ ok: false, error: "Invalid verification code" });
    });

    it("NEGATIVE CONTROL — a failed setup carries no secret to display", async () => {
        setupPost.mockResolvedValue(json({ error: "nope" }, 500));
        const out = await post({ intent: "setup" });
        expect(out).toMatchObject({ ok: false });
        expect((out as { setup?: unknown }).setup).toBeUndefined();
    });
});
