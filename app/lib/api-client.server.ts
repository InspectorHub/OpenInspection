import { hc } from "hono/client";
import { MOUNT } from "./api-mounts";
import type {
    AdminApi,
    AdminBrandingApi,
    AgentApi,
    AgentsApi,
    AgentSignupApi,
    AgentLoginApi,
    AgentTermsApi,
    AgentMagicLoginRequestApi,
    AiApi,
    AnalyticsApi,
    AutomationsApi,
    AvailabilityApi,
    BillingApi,
    BookingsApi,
    CalendarApi,
    CalendarEventsApi,
    ConciergeApi,
    ContractorTypesApi,
    CredentialsApi,
    ContactsApi,
    ContactsImportApi,
    CoreAuthApi,
    DataApi,
    AdminDefectCategoriesApi,
    EventsApi,
    EmailTemplatesApi,
    EvidenceApi,
    IdentityApi,
    InspectionPrefsApi,
    InspectionRequestsApi,
    InspectionsApi,
    InspectionTypesApi,
    InspectionSyncApi,
    InspectionTagApi,
    IntegrationsApi,
    IntegrationsAiApi,
    InvoicesApi,
    MarketplaceApi,
    McpGrantsApi,
    MessageTemplatesApi,
    MessagesApi,
    InspectorMessagesApi,
    MetricsApi,
    MigrationIntakeApi,
    AuditApi,
    NotificationsApi,
    PlacesApi,
    PortalApi,
    PortalNoticesApi,
    NotificationPreferencesApi,
    AgentNotificationPreferencesApi,
    PortalNotificationPreferencesApi,
    AgentNoticesApi,
    ProfileApi,
    PublicShareApi,
    PublicReportApi,
    PublicSlugApi,
    RatingSystemsApi,
    RecommendationsApi,
    RepairBuilderApi,
    RoleProfilesApi,
    ScheduleApi,
    SecretsApi,
    ServicesApi,
    SessionContextApi,
    SmsPublicApi,
    SmsAdminApi,
    TagsApi,
    TeamApi,
    TenantPresenceApi,
    UnsubscribeApi,
    UsageApi,
    UsersApi,
    WidgetApi,
} from "../../packages/api-types";
import { getApiUrl } from "./api.server";
import { makeCsrfPair } from "./csrf";
import { getCloudflareEnv, type LoadContext } from "~/lib/load-context";

export interface CreateApiOptions {
    /** Session JWT — attached as `Authorization: Bearer <token>` when present. */
    token?: string;
}

const NON_GET = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Build the underlying fetch that the typed hc clients use. Layers on:
 *   - Bearer token (when caller passes one)
 *   - CSRF token + matching `__Host-csrf_token` cookie on non-GET requests
 *   - Service Binding (`env.API_WORKER.fetch`) when available; falls back to global fetch
 */
function buildFetch(context: LoadContext, token?: string): typeof fetch {
    const env = getCloudflareEnv(context);

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
    // Spec 3 Task 5 — core /agent-login dual-mode front door (password +
    // magic-link request). Own router file (server/api/agent/login.ts),
    // mounted at the same /api/agent path as `agent`/`agentMagicLogin` above
    // but typed independently for the same TS structural-check-depth reason.
    agentLogin:         ReturnType<typeof hc<AgentLoginApi>>;
    // Spec 3 Task 3 — separate per-module client for the agent unified-link
    // magic-login primitive: it lives in its OWN router file (server/api/agent/
    // magic-login.ts), mounted at the same /api/agent path as `agent` above but
    // typed independently (AgentApi vs AgentMagicLoginRequestApi are different
    // `typeof <router>` types) — merging them into one hc<T> would hit the same
    // structural-check depth limit this per-module split exists to avoid (C-10).
    agentMagicLogin:    ReturnType<typeof hc<AgentMagicLoginRequestApi>>;
    // POST /api/agent/accept-terms — the door in the agent-terms gate. Its own
    // key at the same mount for the same hono/client type-collapse reason as
    // agentLogin/agentMagicLogin above (C-10).
    agentTerms:         ReturnType<typeof hc<AgentTermsApi>>;
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
    contractorTypes:    ReturnType<typeof hc<ContractorTypesApi>>;
    credentials:        ReturnType<typeof hc<CredentialsApi>>;
    contacts:           ReturnType<typeof hc<ContactsApi>>;
    contactsImport:     ReturnType<typeof hc<ContactsImportApi>>;
    data:               ReturnType<typeof hc<DataApi>>;
    defectCategories:   ReturnType<typeof hc<AdminDefectCategoriesApi>>;
    events:             ReturnType<typeof hc<EventsApi>>;
    inspectionTypes:    ReturnType<typeof hc<InspectionTypesApi>>;
    emailTemplates:     ReturnType<typeof hc<EmailTemplatesApi>>;
    evidence:           ReturnType<typeof hc<EvidenceApi>>;
    identity:           ReturnType<typeof hc<IdentityApi>>;
    inspectionPrefs:    ReturnType<typeof hc<InspectionPrefsApi>>;
    inspectionRequests: ReturnType<typeof hc<InspectionRequestsApi>>;
    inspections:        ReturnType<typeof hc<InspectionsApi>>;
    inspectionSync:     ReturnType<typeof hc<InspectionSyncApi>>;
    inspectionTag:      ReturnType<typeof hc<InspectionTagApi>>;
    integrations:       ReturnType<typeof hc<IntegrationsApi>>;
    integrationsAi:     ReturnType<typeof hc<IntegrationsAiApi>>;
    imports:            ReturnType<typeof hc<MigrationIntakeApi>>;
    invoices:           ReturnType<typeof hc<InvoicesApi>>;
    marketplace:        ReturnType<typeof hc<MarketplaceApi>>;
    mcpGrants:          ReturnType<typeof hc<McpGrantsApi>>;
    messageTemplates:   ReturnType<typeof hc<MessageTemplatesApi>>;
    messages:           ReturnType<typeof hc<MessagesApi>>;
    inspectorMessages:  ReturnType<typeof hc<InspectorMessagesApi>>;
    metrics:            ReturnType<typeof hc<MetricsApi>>;
    audit:              ReturnType<typeof hc<AuditApi>>;
    notifications:      ReturnType<typeof hc<NotificationsApi>>;
    places:             ReturnType<typeof hc<PlacesApi>>;
    portal:             ReturnType<typeof hc<PortalApi>>;
    // C3 — the Notices inboxes live in their own router files mounted at the
    // same prefixes, typed independently for the same structural-depth reason
    // as agentMagicLogin above.
    portalNotices:      ReturnType<typeof hc<PortalNoticesApi>>;
    // Notification preferences (§4) — one client per audience. Each mounts at
    // a prefix another module already owns, so they need their own keys for
    // the same reason portalNotices does (hono/client type-collapse, C-10).
    notificationPrefs:      ReturnType<typeof hc<NotificationPreferencesApi>>;
    agentNotificationPrefs: ReturnType<typeof hc<AgentNotificationPreferencesApi>>;
    portalNotificationPrefs: ReturnType<typeof hc<PortalNotificationPreferencesApi>>;
    agentNotices:       ReturnType<typeof hc<AgentNoticesApi>>;
    profile:            ReturnType<typeof hc<ProfileApi>>;
    publicShare:        ReturnType<typeof hc<PublicShareApi>>;
    publicReport:       ReturnType<typeof hc<PublicReportApi>>;
    publicSlug:         ReturnType<typeof hc<PublicSlugApi>>;
    ratingSystems:      ReturnType<typeof hc<RatingSystemsApi>>;
    recommendations:    ReturnType<typeof hc<RecommendationsApi>>;
    repairBuilder:      ReturnType<typeof hc<RepairBuilderApi>>;
    roleProfiles:       ReturnType<typeof hc<RoleProfilesApi>>;
    schedule:           ReturnType<typeof hc<ScheduleApi>>;
    secrets:            ReturnType<typeof hc<SecretsApi>>;
    services:           ReturnType<typeof hc<ServicesApi>>;
    sessionContext:     ReturnType<typeof hc<SessionContextApi>>;
    smsPublic:          ReturnType<typeof hc<SmsPublicApi>>;
    smsAdmin:           ReturnType<typeof hc<SmsAdminApi>>;
    tags:               ReturnType<typeof hc<TagsApi>>;
    team:               ReturnType<typeof hc<TeamApi>>;
    tenantPresence:     ReturnType<typeof hc<TenantPresenceApi>>;
    unsubscribe:        ReturnType<typeof hc<UnsubscribeApi>>;
    usage:              ReturnType<typeof hc<UsageApi>>;
    users:              ReturnType<typeof hc<UsersApi>>;
    widget:             ReturnType<typeof hc<WidgetApi>>;
}


/**
 * Typed BFF-aware client factory. Builds one `hc<TModule>` per module so each
 * stays shallow enough for TS's structural check (the single-root CoreApiType
 * deep intersection used to require `@ts-expect-error`).
 *
 *     const api = createApi(context, { token });
 *     const res = await api.marketplace.index.$get({ query: { page: '1' } });
 */
export function createApi(context: LoadContext, opts: CreateApiOptions = {}): Api {
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
        agentLogin:         mk<AgentLoginApi>(MOUNT.agentLogin),
        agentMagicLogin:    mk<AgentMagicLoginRequestApi>(MOUNT.agentMagicLogin),
        agentTerms:         mk<AgentTermsApi>(MOUNT.agentTerms),
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
        contractorTypes:    mk<ContractorTypesApi>(MOUNT.contractorTypes),
        credentials:        mk<CredentialsApi>(MOUNT.credentials),
        contacts:           mk<ContactsApi>(MOUNT.contacts),
        contactsImport:     mk<ContactsImportApi>(MOUNT.contactsImport),
        data:               mk<DataApi>(MOUNT.data),
        defectCategories:   mk<AdminDefectCategoriesApi>(MOUNT.defectCategories),
        events:             mk<EventsApi>(MOUNT.events),
        inspectionTypes:    mk<InspectionTypesApi>(MOUNT.inspectionTypes),
        emailTemplates:     mk<EmailTemplatesApi>(MOUNT.emailTemplates),
        evidence:           mk<EvidenceApi>(MOUNT.evidence),
        identity:           mk<IdentityApi>(MOUNT.identity),
        inspectionPrefs:    mk<InspectionPrefsApi>(MOUNT.inspectionPrefs),
        inspectionRequests: mk<InspectionRequestsApi>(MOUNT.inspectionRequests),
        inspections:        mk<InspectionsApi>(MOUNT.inspections),
        inspectionSync:     mk<InspectionSyncApi>(MOUNT.inspectionSync),
        inspectionTag:      mk<InspectionTagApi>(MOUNT.inspectionTag),
        integrations:       mk<IntegrationsApi>(MOUNT.integrations),
        integrationsAi:     mk<IntegrationsAiApi>(MOUNT.integrationsAi),
        imports:            mk<MigrationIntakeApi>(MOUNT.imports),
        invoices:           mk<InvoicesApi>(MOUNT.invoices),
        marketplace:        mk<MarketplaceApi>(MOUNT.marketplace),
        mcpGrants:          mk<McpGrantsApi>(MOUNT.mcpGrants),
        messageTemplates:   mk<MessageTemplatesApi>(MOUNT.messageTemplates),
        messages:           mk<MessagesApi>(MOUNT.messages),
        inspectorMessages:  mk<InspectorMessagesApi>(MOUNT.inspectorMessages),
        metrics:            mk<MetricsApi>(MOUNT.metrics),
        audit:              mk<AuditApi>(MOUNT.audit),
        notifications:      mk<NotificationsApi>(MOUNT.notifications),
        places:             mk<PlacesApi>(MOUNT.places),
        portal:             mk<PortalApi>(MOUNT.portal),
        portalNotices:      mk<PortalNoticesApi>(MOUNT.portalNotices),
        notificationPrefs:      mk<NotificationPreferencesApi>(MOUNT.notificationPrefs),
        agentNotificationPrefs: mk<AgentNotificationPreferencesApi>(MOUNT.agentNotificationPrefs),
        portalNotificationPrefs: mk<PortalNotificationPreferencesApi>(MOUNT.portalNotificationPrefs),
        agentNotices:       mk<AgentNoticesApi>(MOUNT.agentNotices),
        profile:            mk<ProfileApi>(MOUNT.profile),
        publicShare:        mk<PublicShareApi>(MOUNT.publicShare),
        publicReport:       mk<PublicReportApi>(MOUNT.publicReport),
        publicSlug:         mk<PublicSlugApi>(MOUNT.publicSlug),
        ratingSystems:      mk<RatingSystemsApi>(MOUNT.ratingSystems),
        recommendations:    mk<RecommendationsApi>(MOUNT.recommendations),
        repairBuilder:      mk<RepairBuilderApi>(MOUNT.repairBuilder),
        roleProfiles:       mk<RoleProfilesApi>(MOUNT.roleProfiles),
        schedule:           mk<ScheduleApi>(MOUNT.schedule),
        secrets:            mk<SecretsApi>(MOUNT.secrets),
        services:           mk<ServicesApi>(MOUNT.services),
        sessionContext:     mk<SessionContextApi>(MOUNT.sessionContext),
        smsPublic:          mk<SmsPublicApi>(MOUNT.smsPublic),
        smsAdmin:           mk<SmsAdminApi>(MOUNT.smsAdmin),
        tags:               mk<TagsApi>(MOUNT.tags),
        team:               mk<TeamApi>(MOUNT.team),
        tenantPresence:     mk<TenantPresenceApi>(MOUNT.tenantPresence),
        unsubscribe:        mk<UnsubscribeApi>(MOUNT.unsubscribe),
        usage:              mk<UsageApi>(MOUNT.usage),
        users:              mk<UsersApi>(MOUNT.users),
        widget:             mk<WidgetApi>(MOUNT.widget),
    };
}
