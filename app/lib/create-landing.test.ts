import { describe, it, expect } from "vitest";
import { createLandingPath } from "~/lib/create-landing";

const api = (res: () => Promise<Response>) => ({ auth: { me: { $get: res } } });
const me = (editReports: boolean) => () => Promise.resolve(new Response(JSON.stringify({ data: { capabilities: { editReports } } })));

describe("createLandingPath", () => {
    it("sends someone who can write report content to the editor", async () => {
        expect(await createLandingPath(api(me(true)), "abc")).toBe("/inspections/abc/edit");
    });
    it("sends office staff to the inspection page", async () => {
        expect(await createLandingPath(api(me(false)), "abc")).toBe("/inspections/abc");
    });
    it("falls back to the inspection page when the profile cannot be read", async () => {
        expect(await createLandingPath(api(() => Promise.reject(new Error("down"))), "abc")).toBe("/inspections/abc");
        expect(await createLandingPath(api(() => Promise.resolve(new Response("{}", { status: 500 }))), "abc")).toBe("/inspections/abc");
        expect(await createLandingPath({}, "abc")).toBe("/inspections/abc");
    });
});
