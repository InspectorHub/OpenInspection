// @vitest-environment node
import { describe, it, expect } from "vitest";
import { summariseNewInspection } from "~/lib/wizard-review";

/**
 * A catalogue read by a caller without the `inspectionFees` capability has no prices
 * at all (the key is absent, not zero). The review must not turn that into a
 * total of $0.
 */
const base = {
    address: "100 Smoke Test Lane, Austin, TX",
    templates: [{ id: "tpl-1", name: "Residential Standard" }],
    templateId: "tpl-1",
    clientName: "",
    clientEmail: "",
    clientPhone: "",
    selectedAgent: null,
    newAgentName: "",
    selectedServiceIds: ["svc-1"],
    priceOverrides: new Map<string, number>(),
    soloMode: true,
    inspectorId: "",
    teamMembers: [],
    selfName: "Sam Owner" as string | null,
};

describe("summariseNewInspection — hidden prices", () => {
    it("has no total when the catalogue carries no prices", () => {
        const s = summariseNewInspection({ ...base, serviceCatalog: [{ id: "svc-1", name: "Roof" }] });
        expect(s.services?.names).toEqual(["Roof"]);
        expect(s.services?.totalCents).toBeNull();
    });

    it("positive control: the same selection with a price still totals it", () => {
        const s = summariseNewInspection({ ...base, serviceCatalog: [{ id: "svc-1", name: "Roof", price: 35000 }] });
        expect(s.services?.totalCents).toBe(35000);
    });
});
