/**
 * Signing in with a second factor — the half that did not exist.
 *
 * `server/api/auth.ts` has answered a 2FA account's correct password with a
 * five-minute challenge token since 2FA was written, and this route replied to
 * that challenge with the string "2FA is not yet supported in the new
 * frontend". So the server knew the password was right, issued a challenge,
 * and the only screen that could have answered it said no.
 *
 * That is a LOCKOUT, not a missing feature: anyone who enabled 2FA could never
 * sign in again, and nothing in the product would have said so beforehand.
 * Which is why this file exists before the Settings panel that turns 2FA on —
 * wiring the switch without wiring this would have shipped the lockout.
 *
 * The assertions are about that specific failure, and about the two ways a
 * half-built version of it goes wrong: dropping the challenge on a mistyped
 * code (which reads to the person as "wrong password"), and parsing a 2FA post
 * as a login (which answers "email is required" to somebody who has already
 * proved their password).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const loginPost = vi.fn();
const twoFaPost = vi.fn();
const createSession = vi.fn();

vi.mock("~/lib/session.server", () => ({
    getToken: vi.fn(async () => null),
    createSessionWithToken: (...args: unknown[]) => createSession(...args),
}));
vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({
        auth: {
            login: Object.assign(
                { $post: (...a: unknown[]) => loginPost(...a) },
                { "2fa": { $post: (...a: unknown[]) => twoFaPost(...a) } },
            ),
        },
    })),
}));
vi.mock("~/lib/load-context", () => ({ getCloudflareEnv: () => ({}) }));
vi.mock("../../server/lib/deployment-profile", () => ({
    getDeploymentProfile: () => ({ loginRedirectBase: null }),
}));

import { action } from "./login";
import { routeArgs } from "../../tests/helpers/route-args";

const CONTEXT = {} as Parameters<typeof action>[0]["context"];
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function post(fields: Record<string, string>) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return action(routeArgs(
        new Request("https://x/login", { method: "POST", body: form }),
        { params: {}, context: CONTEXT },
    ));
}

const CHALLENGE = "challenge.jwt.value";
const GOOD = { email: "a@b.test", password: "hunter2hunter2" };

beforeEach(() => {
    vi.clearAllMocks();
    createSession.mockImplementation((_c, _jwt, dest) => new Response(null, { status: 302, headers: { Location: dest } }));
});

describe("login — a 2FA account is handed a challenge, not a refusal", () => {
    it("CONTROL — a non-2FA login still mints a session, so the branch below is the only change", async () => {
        loginPost.mockResolvedValue(json({ data: { token: "session.jwt" } }));
        await post(GOOD);
        expect(createSession).toHaveBeenCalledTimes(1);
        expect(twoFaPost).not.toHaveBeenCalled();
    });

    it("returns the challenge token instead of an error", async () => {
        loginPost.mockResolvedValue(json({ data: { requires2fa: true, challengeToken: CHALLENGE } }));
        const out = await post(GOOD);
        // Not a session: the second factor has not been supplied yet.
        expect(createSession).not.toHaveBeenCalled();
        expect(out).toMatchObject({ requires2fa: true, challengeToken: CHALLENGE });
    });

    it("carries returnTo through the challenge", async () => {
        // The OAuth consent bounce resumes on the far side of the code form. A
        // version that dropped it would send 2FA users somewhere else than
        // everyone else, only on the flow that has a destination.
        loginPost.mockResolvedValue(json({ data: { requires2fa: true, challengeToken: CHALLENGE } }));
        const out = await post({ ...GOOD, returnTo: "/oauth/authorize?x=1" });
        expect(out).toMatchObject({ returnTo: "/oauth/authorize?x=1" });
    });
});

describe("login — answering the challenge", () => {
    it("posts the code to /login/2fa and never re-posts credentials", async () => {
        twoFaPost.mockResolvedValue(json({ data: { token: "session.jwt" } }));
        await post({ challengeToken: CHALLENGE, code: "123456" });

        expect(loginPost).not.toHaveBeenCalled();
        expect(twoFaPost).toHaveBeenCalledTimes(1);
        expect((twoFaPost.mock.calls[0][0] as { json: unknown }).json)
            .toEqual({ challengeToken: CHALLENGE, code: "123456" });
    });

    it("creates the session at the requested destination on success", async () => {
        twoFaPost.mockResolvedValue(json({ data: { token: "session.jwt" } }));
        await post({ challengeToken: CHALLENGE, code: "123456", returnTo: "/oauth/authorize?x=1" });
        expect(createSession).toHaveBeenCalledWith(CONTEXT, "session.jwt", "/oauth/authorize?x=1");
    });

    it("hands the challenge BACK when the code is rejected", async () => {
        // The failure that matters. Dropping the token here returns the person
        // to the password form, which reads as "your password was wrong" —
        // a working second factor reported as a broken login.
        twoFaPost.mockResolvedValue(json({ error: "Invalid verification code" }, 401));
        const out = await post({ challengeToken: CHALLENGE, code: "000000" });

        expect(out).toMatchObject({ requires2fa: true, challengeToken: CHALLENGE });
        expect((out as { error: string }).error).toBeTruthy();
        expect(createSession).not.toHaveBeenCalled();
    });

    it("rejects a short code without spending the challenge", async () => {
        const out = await post({ challengeToken: CHALLENGE, code: "12" });
        expect(twoFaPost).not.toHaveBeenCalled();
        expect(out).toMatchObject({ requires2fa: true, challengeToken: CHALLENGE });
    });

    it("does not run the credential schema over a 2FA post", async () => {
        // A 2FA submission carries no email or password. Parsed as a login it
        // would answer "email is required" to somebody who has already proved
        // their password — the branch order in the action is what prevents it.
        twoFaPost.mockResolvedValue(json({ data: { token: "session.jwt" } }));
        const out = await post({ challengeToken: CHALLENGE, code: "123456" });
        expect(out).toBeInstanceOf(Response);
    });
});
