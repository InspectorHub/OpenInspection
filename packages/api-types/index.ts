// Legacy single-root export — kept for backwards compat + the route-metadata
// Vitest gate. Frontend should use the per-module types below — they avoid
// the 40+ MergeSchemaPath intersection that busts TS structural checks.
export type { CoreApiType } from '../../server/index';

// Per-module typed-client surface. One client per module so `hc<TModule>`
// stays under the TS structural check depth limit.
export type { AdminApi }              from '../../server/api/admin';
export type { AdminBrandingApi }      from '../../server/api/admin/branding';
export type { AgentApi }              from '../../server/api/agent';
export type { AgentsApi }             from '../../server/api/agents';
export type { AgentSignupApi }        from '../../server/api/agent-signup';
export type { AiApi }                 from '../../server/api/ai';
export type { AnalyticsApi }          from '../../server/api/analytics';
export type { AutomationsApi }        from '../../server/api/automations';
export type { AvailabilityApi }       from '../../server/api/availability';
export type { BillingApi }            from '../../server/api/billing';
export type { BookingsApi }           from '../../server/api/bookings';
export type { CalendarApi }           from '../../server/api/calendar';
export type { CalendarEventsApi }     from '../../server/api/calendar-events';
export type { ConciergeApi }          from '../../server/api/concierge';
export type { ContractorTypesApi }    from '../../server/api/contractor-types';
export type { ContactsApi }           from '../../server/api/contacts';
export type { ContactsImportApi }     from '../../server/api/contacts/import';
export type { CoreAuthApi }           from '../../server/api/auth';
export type { DataApi }               from '../../server/api/data';
export type { EventsApi }             from '../../server/api/events';
export type { EvidenceApi }           from '../../server/api/evidence';
export type { GuestApi }              from '../../server/api/guest';
export type { IdentityApi }           from '../../server/api/identity';
export type { InspectionPrefsApi }    from '../../server/api/inspection-prefs';
export type { InspectionRequestsApi } from '../../server/api/inspection-requests';
export type { InspectionsApi }        from '../../server/api/inspections';
export type { InspectionSyncApi }     from '../../server/api/inspection-sync';
export type { InspectionTagApi }      from '../../server/api/tags';
export type { IntegrationsApi }       from '../../server/api/integrations';
export type { InvoicesApi }           from '../../server/api/invoices';
export type { MarketplaceApi }        from '../../server/api/marketplace';
export type { MessagesApi }           from '../../server/api/messages';
export type { MetricsApi }            from '../../server/api/metrics';
export type { NotificationsApi }      from '../../server/api/notifications';
export type { PlacesApi }             from '../../server/api/places';
export type { ProfileApi }            from '../../server/api/profile';
export type { PublicShareApi }        from '../../server/api/public-share';
export type { PublicReportApi }       from '../../server/api/public-report';
export type { PublicSlugApi }         from '../../server/api/public-slug';
export type { RatingSystemsApi }      from '../../server/api/rating-systems';
export type { RecommendationsApi }    from '../../server/api/recommendations';
export type { RepairRequestsApi }     from '../../server/api/repair-requests';
export type { EmailTemplatesApi }     from '../../server/api/email-templates';
export type { SecretsApi }            from '../../server/api/secrets';
export type { ServicesApi }           from '../../server/api/services';
export type { SmsPublicApi, SmsAdminApi } from '../../server/api/sms';
export type { SessionContextApi }     from '../../server/api/session-context';
export type { TagsApi }               from '../../server/api/tags';
export type { TeamApi }               from '../../server/api/team';
export type { TemplateMigrationsApi } from '../../server/api/template-migrations';
export type { TenantPresenceApi }     from '../../server/api/tenant-presence';
export type { UsageApi }              from '../../server/api/usage';
export type { UsersApi }              from '../../server/api/users';
export type { WidgetApi }             from '../../server/api/widget';
