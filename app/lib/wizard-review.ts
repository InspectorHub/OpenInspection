/**
 * New Inspection wizard — template matching and the final review.
 *
 * Two things the wizard used to do in markup, moved here so they can be read
 * and tested on their own:
 *
 *  - matchTemplates: the template picker was a filter box, a <select> the filter
 *    narrowed, and an echo line repeating the selected name — three controls and
 *    an invisible fourth behaviour (typing until one template matched selected
 *    it) for a single decision. One combobox needs only the filter rule.
 *
 *  - summariseNewInspection: the wizard's last step was whichever thin step came
 *    last, so "Create" was pressed with no statement of what would be created.
 *    A wrong template picked on step 1 was unreviewable by the time it mattered.
 */

export interface NamedTemplate {
    id: string;
    name: string;
}

/** Case-insensitive substring filter. A blank query matches everything; a query that matches nothing returns nothing. */
export function matchTemplates<T extends NamedTemplate>(templates: T[], query: string): T[] {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => t.name.toLowerCase().includes(q));
}

export interface NewInspectionSummaryInput {
    address: string;
    templates: NamedTemplate[];
    templateId: string;
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    /** An existing agent contact, when one was picked from Contacts. */
    selectedAgent: { id: string; name: string; email: string | null } | null;
    /** A name typed into the inline "new agent" fields. */
    newAgentName: string;
    serviceCatalog: Array<{ id: string; name: string; price?: number | null }>;
    selectedServiceIds: string[];
    /** serviceId → cents, for the lines whose price the inspector edited. */
    priceOverrides: Map<string, number>;
    soloMode: boolean;
    inspectorId: string;
    teamMembers: Array<{ id: string; name: string }>;
}

export interface NewInspectionSummary {
    address: string;
    /** Template NAME. Null when the selection no longer resolves — an id is not an answer. */
    template: string | null;
    /** "Name · email · phone", from whichever parts were given. Null when People was skipped. */
    client: string | null;
    agent: string | null;
    /** Null when no service was selected — an empty list and a skipped step read the same otherwise. */
    services: { names: string[]; totalCents: number } | null;
    /** Null means "whoever is creating this" — naming the caller back to themselves adds nothing. */
    assignee: string | null;
}

export function summariseNewInspection(input: NewInspectionSummaryInput): NewInspectionSummary {
    const template = input.templates.find((t) => t.id === input.templateId)?.name ?? null;

    const clientParts = [input.clientName, input.clientEmail, input.clientPhone]
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    const client = clientParts.length > 0 ? clientParts.join(" · ") : null;

    // agentContactId wins over newAgent server-side, so the summary reports the
    // same precedence rather than whatever the UI happens to have cleared.
    const agent = input.selectedAgent?.name ?? (input.newAgentName.trim() || null);

    const picked = input.selectedServiceIds
        .map((id) => input.serviceCatalog.find((s) => s.id === id))
        .filter((s): s is NonNullable<typeof s> => s != null);
    const services = picked.length > 0
        ? {
            names: picked.map((s) => s.name),
            // The price that will actually be charged: an override replaces the
            // catalog price, it does not add to it.
            totalCents: picked.reduce(
                (sum, s) => sum + (input.priceOverrides.get(s.id) ?? s.price ?? 0),
                0,
            ),
        }
        : null;

    const assignee = !input.soloMode && input.inspectorId
        ? input.teamMembers.find((mem) => mem.id === input.inspectorId)?.name ?? null
        : null;

    return { address: input.address, template, client, agent, services, assignee };
}
