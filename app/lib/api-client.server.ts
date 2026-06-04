import { hc } from "hono/client";
import type { AppLoadContext } from "react-router";
import type {
    AdminApi,
    AdminBrandingApi,
    AgentApi,
    AgentsApi,
    AgentSignupApi,
    AiApi,
    AnalyticsApi,
    AutomationsApi,
    AvailabilityApi,
    BillingApi,
    BookingsApi,
    CalendarApi,
    CalendarEventsApi,
    ConciergeApi,
    ContactsApi,
    ContactsImportApi,
    CoreAuthApi,
    DataApi,
    EventsApi,
    EmailTemplatesApi,
    EvidenceApi,
    GuestApi,
    IdentityApi,
    InspectionPrefsApi,
    InspectionRequestsApi,
    InspectionsApi,
    InspectionSyncApi,
    InspectionTagApi,
    IntegrationsApi,
    InvoicesApi,
    MarketplaceApi,
    MessagesApi,
    MetricsApi,
    NotificationsApi,
    PlacesApi,
    ProfileApi,
    PublicShareApi,
    PublicReportApi,
    PublicSlugApi,
    RatingSystemsApi,
    RecommendationsApi,
    RepairRequestsApi,
    SecretsApi,
    ServicesApi,
    SessionContextApi,
    TagsApi,
    TeamApi,
    TemplateMigrationsApi,
    TenantPresenceApi,
    UsersApi,
    WidgetApi,
} from "../../packages/api-types";
import { getApiUrl } from "./api.server";
import { makeCsrfPair } from "./csrf";

export interface CreateApiOptions {
    /** Session JWT — attached as `Authorization: Bearer <token>` when present. */
    token?: string;
}

interface BffEnv {
    API_WORKER?: { fetch: typeof fetch };
}

const NON_GET = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Build the underlying fetch that the typed hc clients use. Layers on:
 *   - Bearer token (when caller passes one)
 *   - CSRF token + matching `__Host-csrf_token` cookie on non-GET requests
 *   - Service Binding (`env.API_WORKER.fetch`) when available; falls back to global fetch
 */
function buildFetch(context: AppLoadContext, token?: string): typeof fetch {
    const env = (context.cloudflare?.env ?? {}) as BffEnv;

    return (async (input: Request | string | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const method = req.method.toUpperCase();

        const headers = new Headers(req.headers);
        if (token && !headers.has("Authorization")) {
            headers.set("Authorization", `Bearer ${token}`);
        }
        if (NON_GET.has(method)) {
            const { headerValue, cookieValue } = makeCsrfPair();
            headers.set("x-csrf-token", headerValue);
            const existingCookie = headers.get("Cookie") ?? "";
            headers.set("Cookie", existingCookie ? `${existingCookie}; ${cookieValue}` : cookieValue);
        }

        const outgoing = new Request(req, { headers });

        if (env.API_WORKER) {
            return env.API_WORKER.fetch(outgoing);
        }
        return fetch(outgoing);
    }) as typeof fetch;
}

export interface Api {
    admin:              ReturnType<typeof hc<AdminApi>>;
    adminBranding:      ReturnType<typeof hc<AdminBrandingApi>>;
    agent:              ReturnType<typeof hc<AgentApi>>;
    agents:             ReturnType<typeof hc<AgentsApi>>;
    agentSignup:        ReturnType<typeof hc<AgentSignupApi>>;
    ai:                 ReturnType<typeof hc<AiApi>>;
    analytics:          ReturnType<typeof hc<AnalyticsApi>>;
    auth:               ReturnType<typeof hc<CoreAuthApi>>;
    automations:        ReturnType<typeof hc<AutomationsApi>>;
    availability:       ReturnType<typeof hc<AvailabilityApi>>;
    billing:            ReturnType<typeof hc<BillingApi>>;
    bookings:           ReturnType<typeof hc<BookingsApi>>;
    calendar:           ReturnType<typeof hc<CalendarApi>>;
    calendarEvents:     ReturnType<typeof hc<CalendarEventsApi>>;
    concierge:          ReturnType<typeof hc<ConciergeApi>>;
    contacts:           ReturnType<typeof hc<ContactsApi>>;
    contactsImport:     ReturnType<typeof hc<ContactsImportApi>>;
    data:               ReturnType<typeof hc<DataApi>>;
    events:             ReturnType<typeof hc<EventsApi>>;
    emailTemplates:     ReturnType<typeof hc<EmailTemplatesApi>>;
    evidence:           ReturnType<typeof hc<EvidenceApi>>;
    guest:              ReturnType<typeof hc<GuestApi>>;
    identity:           ReturnType<typeof hc<IdentityApi>>;
    inspectionPrefs:    ReturnType<typeof hc<InspectionPrefsApi>>;
    inspectionRequests: ReturnType<typeof hc<InspectionRequestsApi>>;
    inspections:        ReturnType<typeof hc<InspectionsApi>>;
    inspectionSync:     ReturnType<typeof hc<InspectionSyncApi>>;
    inspectionTag:      ReturnType<typeof hc<InspectionTagApi>>;
    integrations:       ReturnType<typeof hc<IntegrationsApi>>;
    invoices:           ReturnType<typeof hc<InvoicesApi>>;
    marketplace:        ReturnType<typeof hc<MarketplaceApi>>;
    messages:           ReturnType<typeof hc<MessagesApi>>;
    metrics:            ReturnType<typeof hc<MetricsApi>>;
    notifications:      ReturnType<typeof hc<NotificationsApi>>;
    places:             ReturnType<typeof hc<PlacesApi>>;
    profile:            ReturnType<typeof hc<ProfileApi>>;
    publicShare:        ReturnType<typeof hc<PublicShareApi>>;
    publicReport:       ReturnType<typeof hc<PublicReportApi>>;
    publicSlug:         ReturnType<typeof hc<PublicSlugApi>>;
    ratingSystems:      ReturnType<typeof hc<RatingSystemsApi>>;
    recommendations:    ReturnType<typeof hc<RecommendationsApi>>;
    repairRequests:     ReturnType<typeof hc<RepairRequestsApi>>;
    secrets:            ReturnType<typeof hc<SecretsApi>>;
    services:           ReturnType<typeof hc<ServicesApi>>;
    sessionContext:     ReturnType<typeof hc<SessionContextApi>>;
    tags:               ReturnType<typeof hc<TagsApi>>;
    team:               ReturnType<typeof hc<TeamApi>>;
    templateMigrations: ReturnType<typeof hc<TemplateMigrationsApi>>;
    tenantPresence:     ReturnType<typeof hc<TenantPresenceApi>>;
    users:              ReturnType<typeof hc<UsersApi>>;
    widget:             ReturnType<typeof hc<WidgetApi>>;
}

/**
 * Module mount paths. Verified against `apps/core/server/index.ts` route()
 * calls. Some modules share a mount (e.g. inspections + inspectionSync +
 * inspectionTag all under `/api/inspections`); each client only sees ITS OWN
 * routes typed in its `*Api`, so collisions on the path prefix are fine.
 */
const MOUNT: Record<keyof Api, string> = {
    admin:              "/api/admin",
    adminBranding:      "/api/admin",
    agent:              "/api/agent",
    agents:             "/api/agents",
    agentSignup:        "/api/agent-signup",
    ai:                 "/api/ai",
    analytics:          "/api/analytics",
    auth:               "/api/auth",
    automations:        "/api/automations",
    availability:       "/api/availability",
    billing:            "/api/billing",
    bookings:           "/api/public",
    calendar:           "/api/calendar",
    calendarEvents:     "/api/calendar/events",
    concierge:          "/api/concierge",
    contacts:           "/api/contacts",
    contactsImport:     "/api/contacts",
    data:               "/api/data",
    events:             "/api",
    emailTemplates:     "/api/admin",
    evidence:           "/api/admin",
    guest:              "/api/guest",
    identity:           "/api/identities",
    inspectionPrefs:    "/api/tenant/inspection-prefs",
    inspectionRequests: "/api/inspection-requests",
    inspections:        "/api/inspections",
    inspectionSync:     "/api/inspections",
    inspectionTag:      "/api/inspections",
    integrations:       "/api/integrations",
    invoices:           "/api/invoices",
    marketplace:        "/api/templates/marketplace",
    messages:           "/api/messages",
    metrics:            "/api/metrics",
    notifications:      "/api/notifications",
    places:             "/api/places",
    profile:            "/api/profile",
    publicShare:        "/api/public",
    publicReport:       "/api/public",
    publicSlug:         "/api/public",
    ratingSystems:      "/api/rating-systems",
    recommendations:    "/api/recommendations",
    repairRequests:     "/api/public",
    secrets:            "/api/admin",
    services:           "/api/services",
    sessionContext:     "/api/session",
    tags:               "/api/tags",
    team:               "/api/team",
    templateMigrations: "/api/templates",
    tenantPresence:     "/api/tenant",
    users:              "/api/users",
    widget:             "/api/public/widget",
};

/**
 * Typed BFF-aware client factory. Builds one `hc<TModule>` per module so each
 * stays shallow enough for TS's structural check (the single-root CoreApiType
 * deep intersection used to require `@ts-expect-error`).
 *
 *     const api = createApi(context, { token });
 *     const res = await api.marketplace.index.$get({ query: { page: '1' } });
 */
export function createApi(context: AppLoadContext, opts: CreateApiOptions = {}): Api {
    const baseUrl = getApiUrl(context);
    const fetcher = buildFetch(context, opts.token);

    // `hc<T>` constrains `T extends Hono<...>`. Each per-module type (`AdminApi`,
    // etc.) is `typeof <x>Routes` where `<x>Routes` is an `OpenAPIHono` instance —
    // which extends `Hono` — so the conditional resolves to `T` at every call site
    // below while satisfying the constraint (without it, `hc<T>` errors TS2344 and
    // the whole typed client degrades to loose types — see backlog C-10).
    const mk = <T>(mount: string) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hc<T extends import("hono").Hono<any, any, any> ? T : never>(
            `${baseUrl}${mount}`,
            { fetch: fetcher },
        );

    return {
        admin:              mk<AdminApi>(MOUNT.admin),
        adminBranding:      mk<AdminBrandingApi>(MOUNT.adminBranding),
        agent:              mk<AgentApi>(MOUNT.agent),
        agents:             mk<AgentsApi>(MOUNT.agents),
        agentSignup:        mk<AgentSignupApi>(MOUNT.agentSignup),
        ai:                 mk<AiApi>(MOUNT.ai),
        analytics:          mk<AnalyticsApi>(MOUNT.analytics),
        auth:               mk<CoreAuthApi>(MOUNT.auth),
        automations:        mk<AutomationsApi>(MOUNT.automations),
        availability:       mk<AvailabilityApi>(MOUNT.availability),
        billing:            mk<BillingApi>(MOUNT.billing),
        bookings:           mk<BookingsApi>(MOUNT.bookings),
        calendar:           mk<CalendarApi>(MOUNT.calendar),
        calendarEvents:     mk<CalendarEventsApi>(MOUNT.calendarEvents),
        concierge:          mk<ConciergeApi>(MOUNT.concierge),
        contacts:           mk<ContactsApi>(MOUNT.contacts),
        contactsImport:     mk<ContactsImportApi>(MOUNT.contactsImport),
        data:               mk<DataApi>(MOUNT.data),
        events:             mk<EventsApi>(MOUNT.events),
        emailTemplates:     mk<EmailTemplatesApi>(MOUNT.emailTemplates),
        evidence:           mk<EvidenceApi>(MOUNT.evidence),
        guest:              mk<GuestApi>(MOUNT.guest),
        identity:           mk<IdentityApi>(MOUNT.identity),
        inspectionPrefs:    mk<InspectionPrefsApi>(MOUNT.inspectionPrefs),
        inspectionRequests: mk<InspectionRequestsApi>(MOUNT.inspectionRequests),
        inspections:        mk<InspectionsApi>(MOUNT.inspections),
        inspectionSync:     mk<InspectionSyncApi>(MOUNT.inspectionSync),
        inspectionTag:      mk<InspectionTagApi>(MOUNT.inspectionTag),
        integrations:       mk<IntegrationsApi>(MOUNT.integrations),
        invoices:           mk<InvoicesApi>(MOUNT.invoices),
        marketplace:        mk<MarketplaceApi>(MOUNT.marketplace),
        messages:           mk<MessagesApi>(MOUNT.messages),
        metrics:            mk<MetricsApi>(MOUNT.metrics),
        notifications:      mk<NotificationsApi>(MOUNT.notifications),
        places:             mk<PlacesApi>(MOUNT.places),
        profile:            mk<ProfileApi>(MOUNT.profile),
        publicShare:        mk<PublicShareApi>(MOUNT.publicShare),
        publicReport:       mk<PublicReportApi>(MOUNT.publicReport),
        publicSlug:         mk<PublicSlugApi>(MOUNT.publicSlug),
        ratingSystems:      mk<RatingSystemsApi>(MOUNT.ratingSystems),
        recommendations:    mk<RecommendationsApi>(MOUNT.recommendations),
        repairRequests:     mk<RepairRequestsApi>(MOUNT.repairRequests),
        secrets:            mk<SecretsApi>(MOUNT.secrets),
        services:           mk<ServicesApi>(MOUNT.services),
        sessionContext:     mk<SessionContextApi>(MOUNT.sessionContext),
        tags:               mk<TagsApi>(MOUNT.tags),
        team:               mk<TeamApi>(MOUNT.team),
        templateMigrations: mk<TemplateMigrationsApi>(MOUNT.templateMigrations),
        tenantPresence:     mk<TenantPresenceApi>(MOUNT.tenantPresence),
        users:              mk<UsersApi>(MOUNT.users),
        widget:             mk<WidgetApi>(MOUNT.widget),
    };
}
