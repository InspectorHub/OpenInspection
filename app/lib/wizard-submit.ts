import type { AddressSelection } from "~/routes/resources/places";

/**
 * The form body the New Inspection wizard posts.
 *
 * Pulled out of the component so the contract can be asserted directly rather
 * than through a rendered wizard: the fields here are exactly what
 * `/inspections`'s `create` intent reads, and a field silently dropped on this
 * side is a value the inspector typed and never saw again. Every value is a
 * string because this is submitted as form data.
 */
export interface WizardCreateState {
    propertyType: string;
    address: string;
    addressSel: AddressSelection | null;
    templateId: string;
    serviceIds: string[];
    /** serviceId → cents, for the lines whose price the inspector edited. */
    priceOverrides: Map<string, number>;
    date: string;
    time: string;
    timeZone: string;
    soloMode: boolean;
    inspectorId: string;
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    selectedAgentId: string | null;
    newAgentName: string;
    newAgentEmail: string;
}

export function buildWizardCreatePayload(s: WizardCreateState): Record<string, string> {
    // P-4: serviceSelections carries the per-row price overrides and is the
    // server's authoritative source; serviceIds stays for the plain case.
    const serviceSelectionsJson = JSON.stringify(
        s.serviceIds.map((id) => {
            const override = s.priceOverrides.get(id);
            return override !== undefined ? { serviceId: id, priceOverrideCents: override } : { serviceId: id };
        }),
    );

    return {
        intent: "create",
        propertyType: s.propertyType,
        address: s.address,
        // #198 — structured geocoded address. Empty strings when the inspector
        // typed a free-form address the API could not match; the server stamps
        // addressGeocodedAt itself.
        addressPlaceId: s.addressSel?.placeId ?? "",
        addressStreet: s.addressSel?.street ?? "",
        addressCity: s.addressSel?.city ?? "",
        addressState: s.addressSel?.state ?? "",
        addressZip: s.addressSel?.zip ?? "",
        addressCounty: s.addressSel?.county ?? "",
        addressLat: s.addressSel?.lat != null ? String(s.addressSel.lat) : "",
        addressLng: s.addressSel?.lng != null ? String(s.addressSel.lng) : "",
        templateId: s.templateId,
        serviceIds: s.serviceIds.join(","),
        serviceSelectionsJson,
        date: s.date,
        time: s.time,
        timeZone: s.timeZone,
        soloMode: String(s.soloMode),
        inspectorId: s.inspectorId,
        // IA-1 People step fields
        clientName: s.clientName,
        clientEmail: s.clientEmail,
        clientPhone: s.clientPhone,
        // An existing agent and a newly typed one are mutually exclusive: sending
        // both would have the server create a duplicate contact beside the link.
        agentContactId: s.selectedAgentId ?? "",
        newAgentName: s.selectedAgentId ? "" : s.newAgentName,
        newAgentEmail: s.selectedAgentId ? "" : s.newAgentEmail,
    };
}
