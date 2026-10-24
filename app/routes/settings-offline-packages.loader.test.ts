import { afterEach, describe, expect, it, vi } from "vitest";
import { createLoadContext } from "~/lib/load-context";

/**
 * Who may open the offline-package import page, and where the page learns which
 * company it is importing into. The real role guard runs; only the session
 * cookie lookup and the session-context API answer are scripted.
 */

const payload = Buffer.from(JSON.stringify({ sub: "user-1", "custom:tenantId": "tenant-from-session" })).toString("base64url");
const JWT = `header.${payload}.signature`;

vi.mock("~/lib/session.server", async (importOriginal) => ({
    ...(await importOriginal<typeof import("~/lib/session.server")>()),
    requireToken: async () => JWT,
}));

import { loader } from "./settings-offline-packages";

function stubSession(role: string | null) {
    vi.stubGlobal("fetch", vi.fn(async (input: Request | string) => {
        const path = typeof input === "string" ? input : new URL(input.url).pathname;
        const status = path === "/api/session/context" && role !== null ? 200 : 500;
        const text = JSON.stringify({ data: { user: { role } } });
        return { status, ok: status === 200, headers: { get: () => null }, json: async () => JSON.parse(text), text: async () => text } as unknown as Response;
    }));
}

const run = () => loader({
    request: new Request("https://app.test/settings/offline-packages", { headers: { Cookie: "__session=x" } }),
    context: createLoadContext({ API_URL: "https://mock-api.test" }), params: {},
} as never);

afterEach(() => { vi.unstubAllGlobals(); });

describe("settings/offline-packages loader", () => {
    it.each(["owner", "manager"])("lets a %s in and hands the page the company of the session", async (role) => {
        stubSession(role);
        expect(await run()).toEqual({ forbidden: false, tenantId: "tenant-from-session" });
    });

    it.each(["inspector", "agent", "staff"])("refuses a %s, and tells the page nothing about the company", async (role) => {
        stubSession(role);
        expect(await run()).toEqual({ forbidden: true, tenantId: null });
    });

    it("refuses when the role cannot be read (fails closed)", async () => {
        stubSession(null);
        expect(await run()).toEqual({ forbidden: true, tenantId: null });
    });
});
