// @vitest-environment node
import { describe, it, expect } from "vitest";
import { splitDurationMinutes, serviceIsBookable, didSaveService, toHundredths, fromHundredths } from "~/lib/settings-services";
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

/**
 * The pay-rule unit boundary (#278).
 *
 * The wire is basis points and integer cents; a person types percent and
 * dollars. This conversion is the only place the ×100 happens, so it is the
 * only place the hundredfold money error can be introduced — 60 sent straight
 * through pays 0.6% of the job.
 */
describe("pay-rule human units", () => {
    it("turns a typed percent into basis points, not into itself", () => {
        expect(toHundredths("60")).toBe(6000);
        expect(toHundredths(60)).toBe(6000);
        // The boundary the whole feature turns on: 60 must never reach the API
        // as 60, which the schema would accept as a legal 0.6%.
        expect(toHundredths("60")).not.toBe(60);
    });

    it("keeps a fractional rate exact instead of losing it to float drift", () => {
        expect(toHundredths("62.5")).toBe(6250);
        // 8.2 * 100 is 819.9999999999999 in IEEE-754. Flooring — the obvious
        // way to write this — pays 8.19% forever and the shortfall is invisible
        // because the number on screen still reads 8.2.
        expect(toHundredths("8.2")).toBe(820);
        expect(toHundredths("0.01")).toBe(1);
    });

    it("turns typed dollars into cents the same way", () => {
        expect(toHundredths("125")).toBe(12500);
        expect(toHundredths("125.50")).toBe(12550);
        // 4.35 * 100 is 434.99999999999994 — a cent short of $4.35.
        expect(toHundredths("4.35")).toBe(435);
    });

    it("refuses anything that is not a positive number rather than sending NaN", () => {
        for (const bad of ["", "  ", "abc", "0", "-5", null, undefined]) {
            expect(toHundredths(bad)).toBeNull();
        }
    });

    it("round-trips a stored rule back into the form", () => {
        expect(fromHundredths(6000)).toBe("60");
        expect(fromHundredths(6250)).toBe("62.5");
        expect(fromHundredths(1)).toBe("0.01");
        expect(fromHundredths(null)).toBe("");
    });
});
