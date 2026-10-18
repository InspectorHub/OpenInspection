// @vitest-environment happy-dom
/**
 * The invitation page.
 *
 * Dead end: an invalid or expired invitation used to show a heading and one
 * line, with no way forward. It now offers a log-in link and says what to do.
 * Hosted note: where the person may already hold an account, the form says
 * their existing password stays in use.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createRoutesStub } from "react-router";

const inviteInfo = vi.fn();
vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({ auth: { "invite-info": { $get: (...a: unknown[]) => inviteInfo(...a) } } })),
}));

import JoinPage, { loader } from "./join";
import { m } from "~/paraglide/messages";
import { createLoadContext } from "~/lib/load-context";

type LoaderArgs = Parameters<typeof loader>[0];

afterEach(cleanup);

function renderJoin(data: Record<string, unknown>) {
    const Stub = createRoutesStub([{ path: "/join", Component: JoinPage, loader: () => data }]);
    return render(<Stub initialEntries={["/join?token=t"]} />);
}

const VALID = {
    valid: true,
    error: null,
    invite: { email: "a@b.test", workspaceName: "Acme" },
    token: "t",
};

describe("join page - invalid invitation", () => {
    it("offers a log-in link and tells the person to ask for a new invitation", async () => {
        renderJoin({ valid: false, error: m.auth_join_error_invalid(), invite: null, token: "t", showExistingAccountNote: false });
        const link = await screen.findByRole("link", { name: m.auth_join_invalid_login_link() });
        expect(link.getAttribute("href")).toBe("/login");
        expect(screen.getByText(m.auth_join_invalid_ask_for_new())).toBeTruthy();
    });
});

describe("join page - existing-account note", () => {
    it("is shown when the loader says the deployment shares accounts", async () => {
        renderJoin({ ...VALID, showExistingAccountNote: true });
        expect(await screen.findByText(m.auth_join_existing_account_note())).toBeTruthy();
    });

    it("is absent otherwise", async () => {
        renderJoin({ ...VALID, showExistingAccountNote: false });
        await screen.findByText(m.auth_join_submit());
        expect(screen.queryByText(m.auth_join_existing_account_note())).toBeNull();
    });
});

describe("join loader - which deployments get the note", () => {
    const run = async (env: Record<string, string>) => {
        inviteInfo.mockResolvedValue({
            ok: true,
            json: async () => ({ data: { email: "a@b.test", workspaceName: "Acme" } }),
        });
        return loader({
            request: { url: "http://app.example.com/join?token=t" },
            context: createLoadContext(env),
            params: {},
        } as unknown as LoaderArgs);
    };

    it("hosted (portal base present): true", async () => {
        const res = await run({ APP_MODE: "saas", PORTAL_API_URL: "https://portal.example.test" });
        expect(res).toMatchObject({ valid: true, showExistingAccountNote: true });
    });

    it("standalone: false, even with a base configured", async () => {
        const res = await run({ PORTAL_API_URL: "https://portal.example.test" });
        expect(res).toMatchObject({ valid: true, showExistingAccountNote: false });
    });
});
