/**
 * Login CSRF across every public action that signs someone in, spends a one-time code or records a consent.
 *
 * A page on another site can post a form to these URLs with a code or credentials the attacker owns. Each action must
 * refuse such a post BEFORE it calls the API (so nothing is spent and no session is created) and answer with the
 * page's normal retry or expired state. Each family is paired with the same post from our own origin, which must
 * still reach the API.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const apiCalls = vi.fn();
const createSession = vi.fn(async () => new Response(null, { status: 302 }));

const okResponse = () => new Response(JSON.stringify({ success: true, data: { token: "jwt", redirect: "/" } }), {
    status: 200, headers: { "content-type": "application/json", "set-cookie": "__Host-inspector_token=jwt; Path=/" },
});
/** Any property path is callable; every call is counted and answers 200. */
const deepApi = (): object => new Proxy(function () { /* callable */ }, {
    get: (_t, prop) => (prop === "then" ? undefined : deepApi()),
    apply: () => { apiCalls(); return Promise.resolve(okResponse()); },
});

vi.mock("~/lib/session.server", () => ({
    getToken: vi.fn(async () => null),
    requireToken: vi.fn(async () => "session-token"),
    createSessionWithToken: (...a: unknown[]) => (createSession as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("~/lib/api-client.server", () => ({ createApi: vi.fn(() => deepApi()) }));
vi.mock("~/lib/load-context", () => ({ getCloudflareEnv: () => ({}) }));
vi.mock("../../server/lib/deployment-profile", () => ({ getDeploymentProfile: () => ({ loginRedirectBase: null }) }));

import { action as loginAction } from "./login";
import { action as forgotAction } from "./forgot-password";
import { action as resetAction } from "./reset-password";
import { action as setupAction } from "./setup";
import { action as joinAction } from "./join";
import { action as agentLoginAction } from "./agent/login";
import { action as agentSignupAction } from "./agent/signup";
import { action as acceptTermsAction } from "./agent/accept-terms";
import { action as conciergeAction } from "./public/concierge-confirm-token";
import { action as smsOptinAction } from "./public/sms-optin";
import { action as unsubscribeAction } from "./public/unsubscribe";
import { action as portalAction } from "./public/portal";
import { routeArgs } from "../../tests/helpers/route-args";

const ORIGIN = "https://app.example.com";
const CROSS: Record<string, string> = { "sec-fetch-site": "cross-site", origin: "https://evil.example" };
const SAME: Record<string, string> = { "sec-fetch-site": "same-origin", origin: ORIGIN };
const PASSWORD = "Str0ng!Passw0rd";

interface Case {
    name: string;
    path: string;
    fields: Record<string, string>;
    params?: Record<string, string>;
    run: (args: never) => unknown;
}

const CASES: Case[] = [
    { name: "staff login", path: "/login", fields: { email: "a@example.com", password: PASSWORD }, run: loginAction as Case["run"] },
    { name: "staff 2FA step", path: "/login", fields: { challengeToken: "chal", code: "123456" }, run: loginAction as Case["run"] },
    { name: "forgot password", path: "/forgot-password", fields: { email: "a@example.com" }, run: forgotAction as Case["run"] },
    { name: "reset password", path: "/reset-password", fields: { token: "t", newPassword: PASSWORD }, run: resetAction as Case["run"] },
    { name: "setup", path: "/setup", fields: { workspaceName: "Acme", adminName: "Ada", email: "a@example.com", password: PASSWORD, setupCode: "123456" }, run: setupAction as Case["run"] },
    { name: "join", path: "/join", fields: { token: "t", name: "Ada", password: PASSWORD }, run: joinAction as Case["run"] },
    { name: "agent login (password)", path: "/agent-login", fields: { email: "a@example.com", password: "x" }, run: agentLoginAction as Case["run"] },
    { name: "agent login (link)", path: "/agent-login", fields: { intent: "link", linkEmail: "a@example.com" }, run: agentLoginAction as Case["run"] },
    { name: "agent signup", path: "/agent-signup", fields: { name: "Ada Agent", email: "a@example.com", password: "a-long-enough-password", agentTerms: "on" }, run: agentSignupAction as Case["run"] },
    { name: "agent accept terms", path: "/agent-accept-terms", fields: { agentTerms: "on", shownContentHash: "a".repeat(64) }, run: acceptTermsAction as Case["run"] },
    { name: "concierge confirm", path: "/concierge/confirm/tok", fields: {}, params: { token: "tok" }, run: conciergeAction as Case["run"] },
    { name: "sms opt-in", path: "/sms/optin/tok", fields: {}, params: { token: "tok" }, run: smsOptinAction as Case["run"] },
    { name: "unsubscribe", path: "/unsubscribe/tok", fields: { enabled: "false" }, params: { token: "tok" }, run: unsubscribeAction as Case["run"] },
    { name: "portal request-link", path: "/portal/acme", fields: { email: "a@example.com" }, params: { tenant: "acme" }, run: portalAction as Case["run"] },
];

function send(c: Case, headers: Record<string, string>): Promise<unknown> {
    const form = new FormData();
    for (const [k, v] of Object.entries(c.fields)) form.append(k, v);
    const request = new Request(`${ORIGIN}${c.path}`, { method: "POST", body: form, headers });
    return Promise.resolve(c.run(routeArgs(request, { params: c.params ?? {}, context: {} }) as never));
}

describe("cross-site posts to public actions", () => {
    beforeEach(() => { apiCalls.mockClear(); createSession.mockClear(); });

    describe.each(CASES)("$name", (c) => {
        it("a cross-site post is refused before the API is called and creates no session", async () => {
            const out = await send(c, CROSS);
            expect(apiCalls).not.toHaveBeenCalled();
            expect(createSession).not.toHaveBeenCalled();
            expect(out).toBeDefined();
        });

        it("a post with an Origin that is not ours (no Sec-Fetch-Site) is refused too", async () => {
            await send(c, { origin: "null" });
            expect(apiCalls).not.toHaveBeenCalled();
            expect(createSession).not.toHaveBeenCalled();
        });

        it("positive control: the same post from our own origin reaches the API", async () => {
            await send(c, SAME);
            expect(apiCalls).toHaveBeenCalled();
        });
    });

    it("sign-in actions answer a cross-site post with the page's error state, not a redirect", async () => {
        const login = CASES[0];
        const out = await send(login, CROSS) as { status?: string; error?: unknown };
        expect(out).not.toBeInstanceOf(Response);
        expect(out.status).toBe("error");
        const twoFa = await send(CASES[1], CROSS) as { requires2fa?: boolean; challengeToken?: string; error?: string };
        expect(twoFa.requires2fa).toBe(true);
        expect(twoFa.challengeToken).toBe("chal");
        expect(twoFa.error).toBeTruthy();
    });
});
