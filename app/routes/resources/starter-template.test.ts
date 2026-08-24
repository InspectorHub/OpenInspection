// @vitest-environment happy-dom
/**
 * The starter contacts spreadsheet, as a download.
 *
 * The loader is called DIRECTLY rather than through `createRoutesStub`. That is
 * not a shortcut around a middleware check — this route has no middleware, and
 * the 401 below is produced by the loader's own first two lines. A stub would
 * have been the wrong instrument for a route whose gate lived somewhere else;
 * here it would only have added a router between the assertion and the code
 * that makes the decision.
 *
 * The body is asserted to BE the derived file rather than to look like one. A
 * route that assembled its own header row would pass "returns some CSV" and
 * fail here, which is the whole point of deriving the columns in the first
 * place.
 */
import { vi, beforeEach, describe, it, expect } from "vitest";
import { loader } from "./starter-template";
import { loader as membersLoader } from "./members-template";
import { getToken } from "~/lib/session.server";
import { buildTemplateCsv } from "../../../server/lib/migration-intake/starter-template";
import { CONTACT_EXCHANGE } from "../../../server/lib/data-exchange/contacts";
import { MEMBER_EXCHANGE } from "../../../server/lib/data-exchange/members";
import { routeArgs } from "../../../tests/helpers/route-args";

vi.mock("~/lib/session.server", () => ({ getToken: vi.fn() }));

const getTokenMock = vi.mocked(getToken);

/** Minimal AppLoadContext stub — the loader only forwards it to getToken. */
const CONTEXT = {} as Parameters<typeof loader>[0]["context"];

function call() {
    return loader(
        routeArgs(new Request("https://app.example/resources/contacts-template"), {
            context: CONTEXT,
            params: {},
        }),
    );
}

function callMembers() {
    return membersLoader(
        routeArgs(new Request("https://app.example/resources/members-template"), {
            context: CONTEXT,
            params: {},
        }),
    );
}

describe("resources/starter-template — contacts", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("refuses a caller with no session, and hands back no file at all", async () => {
        getTokenMock.mockResolvedValue(null);
        const res = await call();
        expect(res.status).toBe(401);
        expect(await res.text()).not.toContain("type,name,email");
    });

    it("serves the derived file to a signed-in caller", async () => {
        // The positive control for the refusal above: the same matcher that
        // found nothing there finds the header row here, so "no file" cannot
        // pass because the file never exists.
        getTokenMock.mockResolvedValue("jwt");
        const res = await call();
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("type,name,email");
    });

    it("hands back exactly the derived file, byte for byte", async () => {
        getTokenMock.mockResolvedValue("jwt");
        const res = await call();
        expect(await res.text()).toBe(buildTemplateCsv(CONTACT_EXCHANGE));
    });

    it("tells the browser to save it under a name that says what it is", async () => {
        getTokenMock.mockResolvedValue("jwt");
        const res = await call();
        expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
        expect(res.headers.get("Content-Disposition")).toBe(
            'attachment; filename="contacts-template.csv"',
        );
    });
});

describe("resources/members-template", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("refuses a caller with no session, and hands back no file at all", async () => {
        getTokenMock.mockResolvedValue(null);
        const res = await callMembers();
        expect(res.status).toBe(401);
        expect(await res.text()).not.toContain("email,name,role");
    });

    it("hands back exactly the derived file, byte for byte", async () => {
        // The positive control for the refusal above, and the assertion that
        // this route is derived from the MEMBERS manifest rather than being a
        // second copy of the contacts one.
        getTokenMock.mockResolvedValue("jwt");
        const res = await callMembers();
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(buildTemplateCsv(MEMBER_EXCHANGE));
    });

    it("teaches a DIFFERENT format from the contacts template", async () => {
        getTokenMock.mockResolvedValue("jwt");
        const members = await (await callMembers()).text();
        const contacts = await (await call()).text();
        expect(members).not.toBe(contacts);
        expect(members.startsWith("email,name,role")).toBe(true);
        expect(members).not.toContain("agency");
    });

    it("tells the browser to save it under a name that says what it is", async () => {
        getTokenMock.mockResolvedValue("jwt");
        const res = await callMembers();
        expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
        expect(res.headers.get("Content-Disposition")).toBe(
            'attachment; filename="members-template.csv"',
        );
    });
});
