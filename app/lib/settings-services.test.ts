// @vitest-environment node
import { describe, it, expect } from "vitest";
import { splitDurationMinutes, serviceIsBookable, didSaveService } from "~/lib/settings-services";
import { makeCreateServiceSchema, makeUpdateServiceSchema } from "~/lib/forms/settings.schema";

/**
 * The services catalog asks for three things the product actually consumes, and
 * for a long while the form could supply only two of them.
 *
 * - DURATION: the catalog table has a column for it, and public booking sums it
 *   across the selected services to size the appointment window. Nothing in the
 *   UI could set it, so the column rendered an em dash for every row and every
 *   booking fell back to the generic time-slot length.
 * - TEMPLATE: a booking that selects services builds one inspection per service
 *   from that service's template. A service with no template makes the whole
 *   booking fail with "Service 'X' has no template configured" — a message the
 *   customer sees and the admin has no control to fix.
 */
describe("splitDurationMinutes", () => {
    it("splits whole hours and remainders", () => {
        expect(splitDurationMinutes(45)).toEqual({ hours: 0, minutes: 45 });
        expect(splitDurationMinutes(60)).toEqual({ hours: 1, minutes: 0 });
        expect(splitDurationMinutes(90)).toEqual({ hours: 1, minutes: 30 });
        expect(splitDurationMinutes(240)).toEqual({ hours: 4, minutes: 0 });
    });

    it("returns null when the service carries no duration", () => {
        // A missing duration is not "zero minutes" — it means the booking window
        // falls back to the time-slot length, which is a different statement.
        expect(splitDurationMinutes(null)).toBeNull();
        expect(splitDurationMinutes(undefined)).toBeNull();
        expect(splitDurationMinutes(0)).toBeNull();
        expect(splitDurationMinutes(-30)).toBeNull();
    });

    it("ignores fractional minutes rather than rendering 1 hr 30.5 min", () => {
        expect(splitDurationMinutes(90.7)).toEqual({ hours: 1, minutes: 30 });
    });
});

describe("serviceIsBookable", () => {
    it("is true only when the service names a template", () => {
        expect(serviceIsBookable({ templateId: "tpl-1" })).toBe(true);
        expect(serviceIsBookable({ templateId: null })).toBe(false);
        expect(serviceIsBookable({ templateId: "" })).toBe(false);
        expect(serviceIsBookable({})).toBe(false);
    });
});

describe("didSaveService", () => {
    it("recognises its own create result and nothing else", () => {
        expect(didSaveService({ ok: true, intent: "create-service" }, "create-service")).toBe(true);
        // The toggle-service branch and the action's fallback both answer
        // { ok: true }. Closing the open create form on either of those would
        // discard whatever the admin had typed.
        expect(didSaveService({ ok: true }, "create-service")).toBe(false);
        expect(didSaveService({ ok: true, intent: "qualification-save" }, "create-service")).toBe(false);
        expect(didSaveService({ ok: false, intent: "create-service" }, "create-service")).toBe(false);
        // A Conform failure reply, and no submission at all.
        expect(didSaveService({ status: "error" }, "create-service")).toBe(false);
        expect(didSaveService(undefined, "create-service")).toBe(false);
    });

    // Two forms can be on screen at once (create above the table, edit for one
    // row). Each must close on its own result only, or saving a row would
    // discard a half-typed new service.
    it("does not confuse the two saves for each other", () => {
        expect(didSaveService({ ok: true, intent: "update-service" }, "update-service")).toBe(true);
        expect(didSaveService({ ok: true, intent: "update-service" }, "create-service")).toBe(false);
        expect(didSaveService({ ok: true, intent: "create-service" }, "update-service")).toBe(false);
    });
});

describe("makeUpdateServiceSchema", () => {
    const parse = (input: Record<string, unknown>) => makeUpdateServiceSchema().safeParse(input);

    it("carries which service is being saved", () => {
        const r = parse({ id: "svc-1", name: "Roof", price: "350", durationMinutes: "90", templateId: "tpl-1" });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.id).toBe("svc-1");
    });

    it("refuses a save with no service id, rather than creating something", () => {
        expect(parse({ name: "Roof", price: "350" }).success).toBe(false);
        expect(parse({ id: "", name: "Roof", price: "350" }).success).toBe(false);
    });

    it("holds every field the create form validates, so the two cannot drift", () => {
        // An out-of-range duration is exactly the value an edit would be fixing.
        expect(parse({ id: "svc-1", name: "Roof", durationMinutes: "1800" }).success).toBe(false);
        expect(parse({ id: "svc-1", name: "", price: "350" }).success).toBe(false);
    });

    it("accepts clearing the template, which is a real intent", () => {
        const r = parse({ id: "svc-1", name: "Roof", price: "350", templateId: "" });
        expect(r.success).toBe(true);
    });
});

describe("makeCreateServiceSchema — duration and template", () => {
    const parse = (input: Record<string, unknown>) => makeCreateServiceSchema().safeParse(input);

    it("accepts a service with a duration and a template", () => {
        const r = parse({ name: "Roof", price: "350", durationMinutes: "90", templateId: "tpl-1" });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.durationMinutes).toBe("90");
            expect(r.data.templateId).toBe("tpl-1");
        }
    });

    it("accepts both fields left blank — neither is required to define a service", () => {
        const r = parse({ name: "Roof", price: "350", durationMinutes: "", templateId: "" });
        expect(r.success).toBe(true);
    });

    it("rejects a duration that is not a whole number of minutes", () => {
        expect(parse({ name: "Roof", durationMinutes: "abc" }).success).toBe(false);
        expect(parse({ name: "Roof", durationMinutes: "-15" }).success).toBe(false);
        expect(parse({ name: "Roof", durationMinutes: "45.5" }).success).toBe(false);
    });

    it("rejects a duration longer than a working day, which is a typo not a service", () => {
        // 1440 = 24h. Anything at or past a full day is a slipped decimal point
        // (e.g. "1800" for 18:00), and it would size a booking window absurdly.
        expect(parse({ name: "Roof", durationMinutes: "1440" }).success).toBe(false);
        expect(parse({ name: "Roof", durationMinutes: "1439" }).success).toBe(true);
    });
});
