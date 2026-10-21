import { describe, it, expectTypeOf } from 'vitest';
import type { Hono } from 'hono';
import type { AdminApi } from '../../../server/api/admin';
import type { AdminDefectCategoriesApi } from '../../../server/api/admin/admin-defect-categories';
import type { AdminBrandingApi } from '../../../server/api/admin/branding';
import type { AgentsApi } from '../../../server/api/agents';
import type { AiApi } from '../../../server/api/ai';
import type { AnalyticsApi } from '../../../server/api/analytics';
import type { AutomationsApi } from '../../../server/api/automations';
import type { AvailabilityApi } from '../../../server/api/availability';
import type { BillingApi } from '../../../server/api/billing';
import type { CalendarEventsApi } from '../../../server/api/calendar-events';
import type { ConciergeApi } from '../../../server/api/concierge';
import type { ContactsApi } from '../../../server/api/contacts';
import type { ContactsImportApi } from '../../../server/api/contacts/import';
import type { ContractorTypesApi } from '../../../server/api/contractor-types';
import type { CredentialsApi } from '../../../server/api/credentials';
import type { EmailTemplatesApi } from '../../../server/api/email-templates';
import type { EvidenceApi } from '../../../server/api/evidence';
import type { InspectionPrefsApi } from '../../../server/api/inspection-prefs';
import type { InspectionRequestsApi } from '../../../server/api/inspection-requests';
import type { InspectionsApi } from '../../../server/api/inspections';
import type { IntegrationsApi } from '../../../server/api/integrations';
import type { IntegrationsAiApi } from '../../../server/api/integrations-ai';
import type { IntegrationsTestStepsApi } from '../../../server/api/integrations-test-steps';
import type { InvoicesApi } from '../../../server/api/invoices';
import type { McpGrantsApi } from '../../../server/api/mcp-grants';
import type { MessageTemplatesApi } from '../../../server/api/message-templates';
import type { MigrationIntakeApi } from '../../../server/api/migration-intake';
import type { NotificationPreferencesApi } from '../../../server/api/notification-preferences';
import type { NotificationsApi } from '../../../server/api/notifications';
import type { PlacesApi } from '../../../server/api/places';
import type { ProfileApi } from '../../../server/api/profile';
import type { PublicReportApi } from '../../../server/api/public-report';
import type { PublicShareApi } from '../../../server/api/public-share';
import type { PublicSlugApi } from '../../../server/api/public-slug';
import type { RatingSystemsApi } from '../../../server/api/rating-systems';
import type { RecommendationsApi } from '../../../server/api/recommendations';
import type { RepairBuilderApi } from '../../../server/api/repair-builder';
import type { RoleProfilesApi } from '../../../server/api/role-profiles';
import type { ScheduleApi } from '../../../server/api/schedule-week-summary';
import type { SecretsApi } from '../../../server/api/secrets';
import type { UnsubscribeApi } from '../../../server/api/unsubscribe';
import type { UsageApi } from '../../../server/api/usage';
import type { UsersApi } from '../../../server/api/users';
import type { WidgetApi } from '../../../server/api/widget';

type SchemaOf<A> = A extends Hono<infer _E, infer S, infer _B> ? S : never;
/** `[path, method]` of every endpoint that did not resolve to an object (the library would have dropped such a route). */
type Unresolved<S> = { [P in keyof S]: { [M in keyof S[P]]: [S[P][M]] extends [never] ? [P, M] : never }[keyof S[P]] }[keyof S];
/** Paths whose endpoints are all gone, which a `{}` result of the library's schema builder would have left out. */
type EmptyPaths<S> = { [P in keyof S]: [keyof S[P]] extends [never] ? P : never }[keyof S];

// Compile-time only. `RouteSchema` builds each endpoint lazily through `ToSchema`, which can answer `{}` (no endpoint)
// for a route whose responses are all empty. In the lazy form that would surface as `never`, so every converted
// router is checked for endpoints that resolve to nothing.
describe('converted routers: every route resolves to an endpoint', () => {
    it('has no endpoint that resolves to never and no path without a method', () => {
        expectTypeOf<Unresolved<SchemaOf<AdminApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<BillingApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<ContactsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<IntegrationsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<InvoicesApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<MessageTemplatesApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<MigrationIntakeApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<PublicReportApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<RatingSystemsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<RepairBuilderApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<SecretsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<UsageApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<AdminBrandingApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<AdminDefectCategoriesApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<AgentsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<AiApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<AnalyticsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<AutomationsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<AvailabilityApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<CalendarEventsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<ConciergeApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<ContactsImportApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<ContractorTypesApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<CredentialsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<EmailTemplatesApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<EvidenceApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<InspectionPrefsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<InspectionRequestsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<InspectionsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<IntegrationsAiApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<IntegrationsTestStepsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<McpGrantsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<NotificationPreferencesApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<NotificationsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<PlacesApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<ProfileApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<PublicShareApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<PublicSlugApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<RecommendationsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<RoleProfilesApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<ScheduleApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<UnsubscribeApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<UsersApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<WidgetApi>>>().toEqualTypeOf<never>();
        expectTypeOf<EmptyPaths<SchemaOf<AdminApi>>>().toEqualTypeOf<never>();
        expectTypeOf<EmptyPaths<SchemaOf<InspectionsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<EmptyPaths<SchemaOf<PublicReportApi>>>().toEqualTypeOf<never>();
    });

    it('can say no: the check reports an endpoint that is never (positive control)', () => {
        type Broken = { '/x': { $get: never; $post: { input: {}; output: {}; outputFormat: 'json'; status: 200 } } };
        expectTypeOf<Unresolved<Broken>>().toEqualTypeOf<['/x', '$get']>();
    });
});
