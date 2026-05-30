// Legacy single-root export — kept for backwards compat + the route-metadata
// Vitest gate. Frontend should use the per-module types below — they avoid
// the 40+ MergeSchemaPath intersection that busts TS structural checks.
export type { CoreApiType } from '../../api/src/index';

// Per-module typed-client surface. One client per module so `hc<TModule>`
// stays under the TS structural check depth limit.
export type { AdminApi }              from '../../api/src/api/admin';
export type { AgentApi }              from '../../api/src/api/agent';
export type { AgentsApi }             from '../../api/src/api/agents';
export type { AgentSignupApi }        from '../../api/src/api/agent-signup';
export type { AiApi }                 from '../../api/src/api/ai';
export type { AnalyticsApi }          from '../../api/src/api/analytics';
export type { AutomationsApi }        from '../../api/src/api/automations';
export type { AvailabilityApi }       from '../../api/src/api/availability';
export type { BillingApi }            from '../../api/src/api/billing';
export type { BookingsApi }           from '../../api/src/api/bookings';
export type { CalendarApi }           from '../../api/src/api/calendar';
export type { CalendarEventsApi }     from '../../api/src/api/calendar-events';
export type { ConciergeApi }          from '../../api/src/api/concierge';
export type { ContactsApi }           from '../../api/src/api/contacts';
export type { CoreAuthApi }           from '../../api/src/api/auth';
export type { DataApi }               from '../../api/src/api/data';
export type { EventsApi }             from '../../api/src/api/events';
export type { EvidenceApi }           from '../../api/src/api/evidence';
export type { GuestApi }              from '../../api/src/api/guest';
export type { IdentityApi }           from '../../api/src/api/identity';
export type { InspectionPrefsApi }    from '../../api/src/api/inspection-prefs';
export type { InspectionRequestsApi } from '../../api/src/api/inspection-requests';
export type { InspectionsApi }        from '../../api/src/api/inspections';
export type { InspectionSyncApi }     from '../../api/src/api/inspection-sync';
export type { InspectionTagApi }      from '../../api/src/api/tags';
export type { IntegrationsApi }       from '../../api/src/api/integrations';
export type { InvoicesApi }           from '../../api/src/api/invoices';
export type { MarketplaceApi }        from '../../api/src/api/marketplace';
export type { MessagesApi }           from '../../api/src/api/messages';
export type { MetricsApi }            from '../../api/src/api/metrics';
export type { NotificationsApi }      from '../../api/src/api/notifications';
export type { PlacesApi }             from '../../api/src/api/places';
export type { ProfileApi }            from '../../api/src/api/profile';
export type { PublicShareApi }        from '../../api/src/api/public-share';
export type { PublicSlugApi }         from '../../api/src/api/public-slug';
export type { RatingSystemsApi }      from '../../api/src/api/rating-systems';
export type { RecommendationsApi }    from '../../api/src/api/recommendations';
export type { RepairRequestsApi }     from '../../api/src/api/repair-requests';
export type { SecretsApi }            from '../../api/src/api/secrets';
export type { ServicesApi }           from '../../api/src/api/services';
export type { SessionContextApi }     from '../../api/src/api/session-context';
export type { TagsApi }               from '../../api/src/api/tags';
export type { TeamApi }               from '../../api/src/api/team';
export type { TemplateMigrationsApi } from '../../api/src/api/template-migrations';
export type { TenantPresenceApi }     from '../../api/src/api/tenant-presence';
export type { UsersApi }              from '../../api/src/api/users';
export type { WidgetApi }             from '../../api/src/api/widget';
