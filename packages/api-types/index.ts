// Legacy single-root export — kept for backwards compat + the route-metadata
// Vitest gate. Frontend should use the per-module types below — they avoid
// the 40+ MergeSchemaPath intersection that busts TS structural checks.
export type { CoreApiType } from '../../src/index';

// Per-module typed-client surface. One client per module so `hc<TModule>`
// stays under the TS structural check depth limit.
export type { AdminApi }              from '../../src/api/admin';
export type { AgentApi }              from '../../src/api/agent';
export type { AgentsApi }             from '../../src/api/agents';
export type { AgentSignupApi }        from '../../src/api/agent-signup';
export type { AiApi }                 from '../../src/api/ai';
export type { AnalyticsApi }          from '../../src/api/analytics';
export type { AutomationsApi }        from '../../src/api/automations';
export type { AvailabilityApi }       from '../../src/api/availability';
export type { BillingApi }            from '../../src/api/billing';
export type { BookingsApi }           from '../../src/api/bookings';
export type { CalendarApi }           from '../../src/api/calendar';
export type { CalendarEventsApi }     from '../../src/api/calendar-events';
export type { ConciergeApi }          from '../../src/api/concierge';
export type { ContactsApi }           from '../../src/api/contacts';
export type { CoreAuthApi }           from '../../src/api/auth';
export type { DataApi }               from '../../src/api/data';
export type { EventsApi }             from '../../src/api/events';
export type { EvidenceApi }           from '../../src/api/evidence';
export type { GuestApi }              from '../../src/api/guest';
export type { IdentityApi }           from '../../src/api/identity';
export type { InspectionPrefsApi }    from '../../src/api/inspection-prefs';
export type { InspectionRequestsApi } from '../../src/api/inspection-requests';
export type { InspectionsApi }        from '../../src/api/inspections';
export type { InspectionSyncApi }     from '../../src/api/inspection-sync';
export type { InspectionTagApi }      from '../../src/api/tags';
export type { IntegrationsApi }       from '../../src/api/integrations';
export type { InvoicesApi }           from '../../src/api/invoices';
export type { MarketplaceApi }        from '../../src/api/marketplace';
export type { MessagesApi }           from '../../src/api/messages';
export type { MetricsApi }            from '../../src/api/metrics';
export type { NotificationsApi }      from '../../src/api/notifications';
export type { PlacesApi }             from '../../src/api/places';
export type { ProfileApi }            from '../../src/api/profile';
export type { PublicShareApi }        from '../../src/api/public-share';
export type { PublicSlugApi }         from '../../src/api/public-slug';
export type { RatingSystemsApi }      from '../../src/api/rating-systems';
export type { RecommendationsApi }    from '../../src/api/recommendations';
export type { RepairRequestsApi }     from '../../src/api/repair-requests';
export type { SecretsApi }            from '../../src/api/secrets';
export type { ServicesApi }           from '../../src/api/services';
export type { SessionContextApi }     from '../../src/api/session-context';
export type { TagsApi }               from '../../src/api/tags';
export type { TeamApi }               from '../../src/api/team';
export type { TemplateMigrationsApi } from '../../src/api/template-migrations';
export type { TenantPresenceApi }     from '../../src/api/tenant-presence';
export type { UsersApi }              from '../../src/api/users';
export type { WidgetApi }             from '../../src/api/widget';
