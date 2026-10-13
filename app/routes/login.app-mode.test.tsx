// @vitest-environment happy-dom
/**
 * Sign-in as the native client reaches it.
 *
 * `/oauth/authorize` sends an unauthenticated native request to
 * `/login?app=1&returnTo=/oauth/authorize?...`. Three things have to hold on
 * that page: it offers no way to create an account (the app is for people who
 * already have one; creating a workspace happens in a browser), the person
 * comes back to the authorization they started, and neither `app` nor
 * `returnTo` is lost on the way through a second factor.
 *
 * The page never had a sign-up entry. The first test pins that on purpose, so
 * adding one later fails here instead of reaching the app unnoticed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

const loginPost = vi.fn();
const createSession = vi.fn();
const getToken = vi.fn(async (): Promise<string | null> => null);

vi.mock("~/lib/session.server", () => ({
    getToken: () => getToken(),
    createSessionWithToken: (...args: unknown[]) => createSession(...args),
}));
vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({ auth: { login: { $post: (...a: unknown[]) => loginPost(...a) } } })),
}));
vi.mock("~/lib/load-context", () => ({ getCloudflareEnv: () => ({}) }));
vi.mock("../../server/lib/deployment-profile", () => ({
    getDeploymentProfile: () => ({ loginRedirectBase: null }),
}));

import LoginPage, { action, loader } from "./login";
import { routeArgs } from "../../tests/helpers/route-args";

const CONSENT = "/oauth/authorize?response_type=code&client_id=c1&scope=native";
const CONTEXT = {} as Parameters<typeof action>[0]["context"];

function renderLogin(app: boolean, extra: Record<string, unknown> = {}) {
    const Stub = createRoutesStub([
        {
            path: "/login",
            Component: LoginPage,
            loader: () => ({ returnTo: CONSENT, app }),
            action: () => extra,
        },
    ]);
    return render(<Stub initialEntries={["/login"]} />);
}

const SIGN_UP = /sign up|register|create (an )?(account|workspace)|get started|start (a )?free trial|\/join|\/setup/i;

function hidden(name: string): string | null {
    const el = document.querySelector(`input[type="hidden"][name="${name}"]`);
    return el instanceof HTMLInputElement ? el.value : null;
}

async function reachSecondFactor() {
    const email = await screen.findByLabelText(/email/i);
    // The page validates before it submits, so a real pair has to be typed.
    fireEvent.change(email, { target: { value: "a@b.test" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "hunter2hunter2" } });
    const form = email.closest("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("login form missing");
    const submit = form.querySelector('button[type="submit"]');
    if (!(submit instanceof HTMLButtonElement)) throw new Error("submit button missing");
    form.requestSubmit(submit);
    await waitFor(() => expect(hidden("challengeToken")).toBe("ch"));
}

beforeEach(() => {
    vi.clearAllMocks();
    getToken.mockResolvedValue(null);
    createSession.mockImplementation((_c, _jwt, dest) => new Response(null, { status: 302, headers: { Location: dest } }));
});
afterEach(cleanup);

describe("sign-in page - app mode", () => {
    it("offers no way to create an account, in app mode or out of it", async () => {
        const { unmount } = renderLogin(true);
        await screen.findByLabelText(/email/i);
        expect(document.body.textContent).not.toMatch(SIGN_UP);
        expect(Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "").join(" ")).not.toMatch(SIGN_UP);
        unmount();

        // CONTROL - the plain page has none either, and its one link is found,
        // so the matcher above is not passing merely because it sees nothing.
        renderLogin(false);
        await screen.findByLabelText(/email/i);
        expect(document.body.textContent).not.toMatch(SIGN_UP);
        expect(screen.getByRole("link", { name: /forgot/i })).toBeTruthy();
    });

    it("carries returnTo and app in the credential form", async () => {
        renderLogin(true);
        await screen.findByLabelText(/email/i);
        expect(hidden("returnTo")).toBe(CONSENT);
        expect(hidden("app")).toBe("1");
    });

    it("does not add app to a plain sign-in", async () => {
        renderLogin(false);
        await screen.findByLabelText(/email/i);
        expect(hidden("app")).toBeNull();
        expect(hidden("returnTo")).toBe(CONSENT);
    });

    it("keeps app and returnTo on the second-factor step, including the way back", async () => {
        renderLogin(true, { requires2fa: true, challengeToken: "ch", returnTo: CONSENT, app: true, error: "" });
        await reachSecondFactor();
        expect(hidden("challengeToken")).toBe("ch");
        expect(hidden("app")).toBe("1");
        expect(hidden("returnTo")).toBe(CONSENT);
        const href = screen.getByRole("link", { name: /start over|back/i }).getAttribute("href") ?? "";
        const query = new URLSearchParams(href.split("?")[1] ?? "");
        expect(href.startsWith("/login?")).toBe(true);
        expect(query.get("app")).toBe("1");
        expect(query.get("returnTo")).toBe(CONSENT);
    });

    it("leaves the way back as a bare /login for a plain sign-in", async () => {
        renderLogin(false, { requires2fa: true, challengeToken: "ch", returnTo: "", app: false, error: "" });
        await reachSecondFactor();
        expect(screen.getByRole("link", { name: /start over|back/i }).getAttribute("href")).toBe("/login");
        expect(hidden("app")).toBeNull();
    });
});

describe("sign-in action - where a successful sign-in lands", () => {
    function post(fields: Record<string, string>) {
        const form = new FormData();
        for (const [k, v] of Object.entries(fields)) form.append(k, v);
        return action(routeArgs(new Request("https://x/login?app=1", { method: "POST", body: form }), { params: {}, context: CONTEXT }));
    }
    const CREDS = { email: "a@b.test", password: "hunter2hunter2", app: "1" };
    const apiReply = (data: unknown) =>
        new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { "content-type": "application/json" } });

    it("resumes the authorization it was sent from", async () => {
        loginPost.mockResolvedValue(apiReply({ token: "jwt" }));
        await post({ ...CREDS, returnTo: CONSENT });
        expect(createSession).toHaveBeenCalledWith(CONTEXT, "jwt", CONSENT);
    });

    it.each([
        ["a protocol-relative URL", "//evil.example"],
        ["an absolute URL", "https://evil.example"],
        ["a backslash host", "/\\evil.example"],
        ["a tab hidden between the slashes", "/\t/evil.example"],
        ["a script URL", "javascript:alert(1)"],
    ])("refuses %s and lands on the default page", async (_name, returnTo) => {
        loginPost.mockResolvedValue(apiReply({ token: "jwt" }));
        await post({ ...CREDS, returnTo });
        expect(createSession).toHaveBeenCalledWith(CONTEXT, "jwt", "/inspections");
    });

    it("applies the same rule to a signed-in visitor opening the page", async () => {
        getToken.mockResolvedValue("existing");
        const locationOf = async (url: string) => {
            const res = await loader(routeArgs(new Request(url), { params: {}, context: CONTEXT }));
            if (!(res instanceof Response)) throw new Error("expected a redirect");
            return res.headers.get("Location");
        };
        expect(await locationOf("https://x/login?app=1&returnTo=//evil.example")).toBe("/inspections");
        expect(await locationOf(`https://x/login?app=1&returnTo=${encodeURIComponent(CONSENT)}`)).toBe(CONSENT);
    });

    it("hands the app flag to the second-factor step", async () => {
        loginPost.mockResolvedValue(apiReply({ requires2fa: true, challengeToken: "ch" }));
        const out = await post({ ...CREDS, returnTo: CONSENT });
        expect(out).toMatchObject({ requires2fa: true, app: true, returnTo: CONSENT });
    });
});
