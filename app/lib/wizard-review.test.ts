// @vitest-environment node
import { describe, it, expect } from "vitest";
import { matchTemplates, summariseNewInspection } from "~/lib/wizard-review";

/**
 * The template picker was three controls for one decision: a filter box (shown
 * only past six templates), a <select> whose options the filter narrowed, and a
 * line underneath echoing the name already visible in the select. A fourth
 * control's worth of behaviour was implicit — typing until exactly one template
 * matched silently selected it. One combobox does the same job, so the filtering
 * moves here where it can be tested on its own.
 */
describe("matchTemplates", () => {
    const templates = [
        { id: "a", name: "Residential Standard" },
        { id: "b", name: "Commercial PCA" },
        { id: "c", name: "residential — condo" },
    ];

    it("returns every template for a blank query", () => {
        expect(matchTemplates(templates, "").map((t) => t.id)).toEqual(["a", "b", "c"]);
        expect(matchTemplates(templates, "   ").map((t) => t.id)).toEqual(["a", "b", "c"]);
    });

    it("matches case-insensitively on a substring", () => {
        expect(matchTemplates(templates, "resi").map((t) => t.id)).toEqual(["a", "c"]);
        expect(matchTemplates(templates, "PCA").map((t) => t.id)).toEqual(["b"]);
        expect(matchTemplates(templates, "condo").map((t) => t.id)).toEqual(["c"]);
    });

    it("returns nothing when nothing matches, rather than falling back to all", () => {
        expect(matchTemplates(templates, "zzz")).toEqual([]);
    });
});

/**
 * The wizard's last step used to be whichever thin step came last — one date
 * field, or one radio pair — and "Create" sat next to it. Nothing ever showed
 * what was about to be created, so a mistake made on step 1 (wrong template,
 * wrong client) was unreviewable by the time it mattered. The final step now
 * carries the two remaining single-decision controls AND a summary of the whole
 * thing; this is the part of it that is not markup.
 */
describe("summariseNewInspection", () => {
    const base = {
        address: "100 Smoke Test Lane, Austin, TX",
        templates: [{ id: "tpl-1", name: "Residential Standard" }],
        templateId: "tpl-1",
        clientName: "",
        clientEmail: "",
        clientPhone: "",
        selectedAgent: null,
        newAgentName: "",
        serviceCatalog: [
            { id: "svc-1", name: "Roof", price: 35000 },
            { id: "svc-2", name: "Pool", price: 12500 },
        ],
        selectedServiceIds: [] as string[],
        priceOverrides: new Map<string, number>(),
        soloMode: true,
        inspectorId: "",
        teamMembers: [{ id: "u-1", name: "Dana Inspector" }],
        selfName: "Sam Owner" as string | null,
    };

    it("names the template rather than echoing its id", () => {
        expect(summariseNewInspection(base).template).toBe("Residential Standard");
        // An id with no matching template (stale selection) is not a name.
        expect(summariseNewInspection({ ...base, templateId: "gone" }).template).toBeNull();
    });

    it("omits the client entirely when nothing was entered", () => {
        // People is a legal skip. A review row reading "Client: —" implies a
        // field was left blank by mistake; absence says it was skipped.
        expect(summariseNewInspection(base).client).toBeNull();
    });

    it("joins the client's name with whatever contact details were given", () => {
        expect(summariseNewInspection({ ...base, clientName: "Jane Buyer" }).client).toBe("Jane Buyer");
        expect(
            summariseNewInspection({
                ...base,
                clientName: "Jane Buyer",
                clientEmail: "jane@example.com",
                clientPhone: "(555) 999-0000",
            }).client,
        ).toBe("Jane Buyer · jane@example.com · (555) 999-0000");
    });

    it("prefers the selected contact over a half-typed new agent", () => {
        // The wizard clears one when the other is chosen, but the summary must
        // not depend on that having happened — it reports what will be POSTed,
        // and agentContactId wins server-side.
        expect(
            summariseNewInspection({
                ...base,
                selectedAgent: { id: "c-1", name: "Bob Realtor", email: null },
                newAgentName: "Half Typed",
            }).agent,
        ).toBe("Bob Realtor");
        expect(summariseNewInspection({ ...base, newAgentName: "Bob Realtor" }).agent).toBe("Bob Realtor");
        expect(summariseNewInspection(base).agent).toBeNull();
    });

    it("lists the selected services and totals them at the price that will be charged", () => {
        const s = summariseNewInspection({
            ...base,
            selectedServiceIds: ["svc-1", "svc-2"],
            priceOverrides: new Map([["svc-2", 9900]]),
        });
        expect(s.services?.names).toEqual(["Roof", "Pool"]);
        // 35000 catalog + 9900 override — NOT the 12500 catalog price for svc-2.
        expect(s.services?.totalCents).toBe(44900);
    });

    it("reports no services when none are selected", () => {
        expect(summariseNewInspection(base).services).toBeNull();
    });

    it("ignores a selected id that is not in the catalog", () => {
        const s = summariseNewInspection({ ...base, selectedServiceIds: ["svc-1", "ghost"] });
        expect(s.services?.names).toEqual(["Roof"]);
        expect(s.services?.totalCents).toBe(35000);
    });

    it("names whoever will carry it out, including the viewer", () => {
        // "Inspector: You" was the one row of the review that was not a name,
        // and the name is what the report will carry.
        expect(summariseNewInspection(base).assignee).toBe("Sam Owner");
        expect(
            summariseNewInspection({ ...base, soloMode: false, inspectorId: "u-1" }).assignee,
        ).toBe("Dana Inspector");
        // Not-solo but nobody picked yet — still the viewer's job.
        expect(summariseNewInspection({ ...base, soloMode: false }).assignee).toBe("Sam Owner");
    });

    it("falls back to null when the viewer's own name is unknown", () => {
        // The caller renders "You" for this; a blank row would be worse, and
        // inventing a name would be a lie.
        expect(summariseNewInspection({ ...base, selfName: null }).assignee).toBeNull();
        expect(summariseNewInspection({ ...base, selfName: "   " }).assignee).toBeNull();
    });
});
