import { describe, it, expect } from "vitest";
import { buildCreateInspectionJson, dollarsToCents } from "~/lib/inspection-create";

/**
 * B-8 fix — the New Inspection wizard posts { intent:"create", address,
 * templateId, date, time, inspectorId, ... } to the /inspections action. The
 * action was missing a "create" branch (silent no-op). This helper maps the
 * wizard fields to the CreateInspectionSchema JSON the POST /api/inspections
 * endpoint expects (notably combining the date + time fields into one ISO).
 */
function fd(entries: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
}

describe("buildCreateInspectionJson", () => {
    it("maps address→propertyAddress, templateId, and combines date+time into ISO", () => {
        const json = buildCreateInspectionJson(fd({
            address: "100 Smoke Test Lane, Austin, TX",
            templateId: "625fb306-bde0-4fe9-a0e8-d8151296b23a",
            date: "2026-06-02",
            time: "09:00",
        }));
        expect(json.propertyAddress).toBe("100 Smoke Test Lane, Austin, TX");
        expect(json.templateId).toBe("625fb306-bde0-4fe9-a0e8-d8151296b23a");
        expect(json.date).toBe("2026-06-02T09:00:00Z");
    });

    it("omits date when no date is provided", () => {
        const json = buildCreateInspectionJson(fd({ address: "1 A St", templateId: "t" }));
        expect("date" in json).toBe(false);
    });

    it("includes inspectorId only when it is a valid UUID", () => {
        // empty → omitted
        expect("inspectorId" in buildCreateInspectionJson(fd({ address: "1 A St", templateId: "t", inspectorId: "" }))).toBe(false);
        // non-UUID free text (e.g. a typed name/id) → dropped, since the schema
        // types inspectorId as z.string().uuid() — sending it would 400 the create.
        expect("inspectorId" in buildCreateInspectionJson(fd({ address: "1 A St", templateId: "t", inspectorId: "u9" }))).toBe(false);
        // valid UUID → forwarded
        const uuid = "625fb306-bde0-4fe9-a0e8-d8151296b23a";
        expect(buildCreateInspectionJson(fd({ address: "1 A St", templateId: "t", inspectorId: uuid })).inspectorId).toBe(uuid);
    });

    it("defaults the time to 09:00 when only a date is given", () => {
        const json = buildCreateInspectionJson(fd({ address: "1 A St", templateId: "t", date: "2026-06-02" }));
        expect(json.date).toBe("2026-06-02T09:00:00Z");
    });

    // IA-1 People step tests
    it("maps clientName/clientEmail/clientPhone into client object", () => {
        const json = buildCreateInspectionJson(fd({
            address: "1 A St", templateId: "t",
            clientName: "Jane Buyer",
            clientEmail: "jane@example.com",
            clientPhone: "(555) 999-0000",
        }));
        expect(json.client).toEqual({ name: "Jane Buyer", email: "jane@example.com", phone: "(555) 999-0000" });
    });

    it("omits client entirely when clientName is empty", () => {
        // Leaving the People step completely empty is a legal skip.
        const json = buildCreateInspectionJson(fd({
            address: "1 A St", templateId: "t",
            clientName: "", clientEmail: "", clientPhone: "",
        }));
        expect("client" in json).toBe(false);
    });

    it("omits optional client fields when email and phone are empty", () => {
        const json = buildCreateInspectionJson(fd({
            address: "1 A St", templateId: "t",
            clientName: "John Smith",
        }));
        expect(json.client).toEqual({ name: "John Smith" });
        expect("email" in (json.client ?? {})).toBe(false);
        expect("phone" in (json.client ?? {})).toBe(false);
    });

    it("passes agentContactId when it is a valid UUID", () => {
        const agentId = "aabbccdd-0000-1111-2222-333344445555";
        const json = buildCreateInspectionJson(fd({
            address: "1 A St", templateId: "t",
            agentContactId: agentId,
        }));
        expect(json.agentContactId).toBe(agentId);
        expect("newAgent" in json).toBe(false);
    });

    it("maps newAgentName/newAgentEmail into newAgent when no agentContactId", () => {
        const json = buildCreateInspectionJson(fd({
            address: "1 A St", templateId: "t",
            newAgentName: "Bob Realtor",
            newAgentEmail: "bob@realty.com",
        }));
        expect(json.newAgent).toEqual({ name: "Bob Realtor", email: "bob@realty.com" });
        expect("agentContactId" in json).toBe(false);
    });

    it("agentContactId wins over newAgent when both are present", () => {
        const agentId = "aabbccdd-0000-1111-2222-333344445555";
        const json = buildCreateInspectionJson(fd({
            address: "1 A St", templateId: "t",
            agentContactId: agentId,
            newAgentName: "Bob Realtor",
            newAgentEmail: "bob@realty.com",
        }));
        expect(json.agentContactId).toBe(agentId);
        expect("newAgent" in json).toBe(false);
    });

    // P-4 serviceSelections / price override tests
    it("maps serviceSelectionsJson with priceOverrideCents into serviceSelections", () => {
        const selections = [
            { serviceId: "svc-1", priceOverrideCents: 44999 },
            { serviceId: "svc-2" },
        ];
        const json = buildCreateInspectionJson(fd({
            address: "1 A St", templateId: "t",
            serviceSelectionsJson: JSON.stringify(selections),
        }));
        expect(json.serviceSelections).toEqual(selections);
        // Legacy serviceIds list is also emitted for backward compat.
        expect(json.serviceIds).toEqual(["svc-1", "svc-2"]);
    });

    it("emits no priceOverrideCents for a service with no override", () => {
        const selections = [{ serviceId: "svc-only" }];
        const json = buildCreateInspectionJson(fd({
            address: "1 A St", templateId: "t",
            serviceSelectionsJson: JSON.stringify(selections),
        }));
        expect(json.serviceSelections).toHaveLength(1);
        expect("priceOverrideCents" in json.serviceSelections![0]).toBe(false);
    });

    it("falls back to legacy serviceIds when serviceSelectionsJson is absent", () => {
        const json = buildCreateInspectionJson(fd({
            address: "1 A St", templateId: "t",
            serviceIds: "svc-a,svc-b",
        }));
        expect(json.serviceIds).toEqual(["svc-a", "svc-b"]);
        expect("serviceSelections" in json).toBe(false);
    });

    it("omits both serviceIds and serviceSelections when neither is provided", () => {
        const json = buildCreateInspectionJson(fd({ address: "1 A St", templateId: "t" }));
        expect("serviceIds" in json).toBe(false);
        expect("serviceSelections" in json).toBe(false);
    });

    // #198 structured-address forwarding
    it("forwards structured address fields (with numeric lat/lng) when a Places suggestion was picked", () => {
        const json = buildCreateInspectionJson(fd({
            address: "123 Main St, Austin, TX 78701",
            templateId: "t",
            addressPlaceId: "ChIJabc",
            addressStreet: "123 Main St",
            addressCity: "Austin",
            addressState: "TX",
            addressZip: "78701",
            addressCounty: "Travis",
            addressLat: "30.2672",
            addressLng: "-97.7431",
        }));
        expect(json.addressPlaceId).toBe("ChIJabc");
        expect(json.addressStreet).toBe("123 Main St");
        expect(json.addressCity).toBe("Austin");
        expect(json.addressState).toBe("TX");
        expect(json.addressZip).toBe("78701");
        expect(json.addressCounty).toBe("Travis");
        expect(json.addressLat).toBeCloseTo(30.2672);
        expect(json.addressLng).toBeCloseTo(-97.7431);
    });

    it("omits all structured address fields for a hand-typed free-form address", () => {
        const json = buildCreateInspectionJson(fd({ address: "Grandma's cabin by the lake", templateId: "t" }));
        expect("addressPlaceId" in json).toBe(false);
        expect("addressLat" in json).toBe(false);
        expect("addressLng" in json).toBe(false);
    });

    it("drops non-finite lat/lng rather than forwarding NaN", () => {
        const json = buildCreateInspectionJson(fd({
            address: "1 A St", templateId: "t",
            addressLat: "not-a-number", addressLng: "",
        }));
        expect("addressLat" in json).toBe(false);
        expect("addressLng" in json).toBe(false);
    });
});

describe("dollarsToCents", () => {
    it("converts '449.99' to 44999 (not 44998.999 float trap)", () => {
        expect(dollarsToCents("449.99")).toBe(44999);
    });

    it("converts exact integers correctly", () => {
        expect(dollarsToCents("400")).toBe(40000);
        expect(dollarsToCents(400)).toBe(40000);
    });

    it("converts '0.01' to 1 cent", () => {
        expect(dollarsToCents("0.01")).toBe(1);
    });

    it("returns undefined for empty string", () => {
        expect(dollarsToCents("")).toBeUndefined();
    });

    it("returns undefined for null/undefined", () => {
        expect(dollarsToCents(null)).toBeUndefined();
        expect(dollarsToCents(undefined)).toBeUndefined();
    });

    it("returns undefined for negative values", () => {
        expect(dollarsToCents("-1")).toBeUndefined();
    });

    it("uses Math.round so 449.99 never becomes 44998 (the float trap)", () => {
        // parseFloat("449.99") * 100 = 44998.999999999996 in IEEE 754.
        // Without Math.round (using Math.floor or truncation) this would be 44998.
        // Math.round correctly gives 44999.
        expect(dollarsToCents("449.99")).toBe(44999);
        // Double-check: 99.99 * 100 = 9998.999... → must round to 9999.
        expect(dollarsToCents("99.99")).toBe(9999);
    });
});
