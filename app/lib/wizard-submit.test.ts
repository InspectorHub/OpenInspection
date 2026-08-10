// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildWizardCreatePayload, type WizardCreateState } from "~/lib/wizard-submit";

const base: WizardCreateState = {
    propertyType: "single_family",
    address: "412 Alder Court, Springfield, IL",
    addressSel: null,
    templateId: "tpl-1",
    serviceIds: [],
    priceOverrides: new Map(),
    date: "2026-07-25",
    time: "09:00",
    timeZone: "America/Chicago",
    soloMode: true,
    inspectorId: "",
    clientName: "",
    clientEmail: "",
    clientPhone: "",
    selectedAgentId: null,
    newAgentName: "",
    newAgentEmail: "",
};

/**
 * Every field the wizard collects has to reach the action, or it is a value the
 * inspector typed and never saw again. Asserted here rather than through a
 * rendered wizard: the DOM route can only check what a walkthrough happens to
 * fill in, and it is the field NOT being sent that is the failure.
 */
describe("buildWizardCreatePayload", () => {
    it("carries every answer the wizard asks for", () => {
        const payload = buildWizardCreatePayload({
            ...base,
            clientName: "Dana Whitfield",
            clientEmail: "dana@example.com",
            clientPhone: "555-0000",
            newAgentName: "Ray Agent",
            newAgentEmail: "ray@example.com",
            serviceIds: ["svc-1"],
        });
        expect(payload).toMatchObject({
            intent: "create",
            propertyType: "single_family",
            address: "412 Alder Court, Springfield, IL",
            templateId: "tpl-1",
            date: "2026-07-25",
            time: "09:00",
            // The wizard sends the zone it NAMED beside the time field; without it
            // the server would read the wall clock in its own zone.
            timeZone: "America/Chicago",
            clientName: "Dana Whitfield",
            clientEmail: "dana@example.com",
            clientPhone: "555-0000",
            newAgentName: "Ray Agent",
            newAgentEmail: "ray@example.com",
            serviceIds: "svc-1",
        });
    });

    it("sends an existing agent as a link, and never also as a new contact", () => {
        // Sending both would have the server create a duplicate beside the link.
        const payload = buildWizardCreatePayload({
            ...base,
            selectedAgentId: "contact-9",
            newAgentName: "leftover typing",
            newAgentEmail: "leftover@example.com",
        });
        expect(payload.agentContactId).toBe("contact-9");
        expect(payload.newAgentName).toBe("");
        expect(payload.newAgentEmail).toBe("");
    });

    it("keeps a price override with its service", () => {
        const payload = buildWizardCreatePayload({
            ...base,
            serviceIds: ["svc-1", "svc-2"],
            priceOverrides: new Map([["svc-2", 12345]]),
        });
        expect(JSON.parse(payload.serviceSelectionsJson)).toEqual([
            { serviceId: "svc-1" },
            { serviceId: "svc-2", priceOverrideCents: 12345 },
        ]);
    });

    it("distinguishes an override of zero from no override at all", () => {
        // Free-of-charge is a real answer; a falsy check would drop it.
        const payload = buildWizardCreatePayload({
            ...base,
            serviceIds: ["svc-1"],
            priceOverrides: new Map([["svc-1", 0]]),
        });
        expect(JSON.parse(payload.serviceSelectionsJson)).toEqual([
            { serviceId: "svc-1", priceOverrideCents: 0 },
        ]);
    });

    it("sends blank structured-address fields for a free-form address", () => {
        // The API could not match it; the inspector can still submit what they typed.
        const payload = buildWizardCreatePayload(base);
        expect(payload.addressPlaceId).toBe("");
        expect(payload.addressLat).toBe("");
        expect(payload.address).toBe(base.address);
    });

    it("stringifies coordinates, including a legitimate zero", () => {
        const payload = buildWizardCreatePayload({
            ...base,
            addressSel: {
                placeId: "p1",
                formatted: "Null Island",
                street: "1 Equator St",
                city: "",
                state: "",
                zip: "",
                county: "",
                lat: 0,
                lng: 0,
            },
        });
        expect(payload.addressLat).toBe("0");
        expect(payload.addressLng).toBe("0");
    });
});
