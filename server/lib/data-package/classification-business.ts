/**
 * Classification, family 3 of 3: people and scheduling, catalogue and
 * pricing, billing, messaging, calendar, accounting and statutory forms.
 */
import {
    availability, availabilityOverrides, serviceInspectors, services, discountCodes, automations,
    automationLogs, messageTemplates, emailTemplates, emailSuppressions, smsDeliveryStatus,
    inspectorServiceAreas, contacts, contactRoleProfiles, contractorTypes, invoices, orderPayments,
    servicePayRules, inspectionServicePaySplits, calendarBlocks, calendarConnections,
    calendarConnectionReadCalendars, calendarExternalLinks, qboConnections, qboEntityMap, qboSyncErrors,
    marketplaceLibraries, tenantLibraryImports, tenantMarketplaceImportHistory, statutoryFormEntries,
    statutoryFormProductions, statutoryFormSightings, statutoryFormVersions, statutoryInspectionDetails,
} from '../db/schema';
import { archiveTable, exportTable, outTable, withholdTable, type ClassifiedTable } from './classification-types';

const OWNED = 'Business data the tenant authored or owns.';
const EPHEMERAL = 'Transient or derived operational state; regenerated or irrelevant on another deployment.';
const GLOBAL_REASON = 'Deployment-wide catalogue with no tenant_id: not the tenant\'s data.';
const BOOKKEEPING = 'Import bookkeeping bound to the source catalogue.';

export const BUSINESS_FAMILY: readonly ClassifiedTable[] = [
    exportTable(availability, 'direct', OWNED),
    exportTable(availabilityOverrides, 'direct', 'Business data the tenant authored. source and external_id point at an external calendar of the source deployment and are reset to NULL.', {
        reset: {
            source: 'Names an external calendar of the source deployment; set to NULL.',
            externalId: 'Id in an external calendar of the source deployment; set to NULL.',
        },
    }),
    exportTable(serviceInspectors, 'direct', OWNED),
    exportTable(services, 'direct', OWNED),
    exportTable(discountCodes, 'direct', OWNED),
    exportTable(automations, 'direct', OWNED),
    outTable(automationLogs, 'direct', EPHEMERAL),
    exportTable(messageTemplates, 'direct', OWNED),
    exportTable(emailTemplates, 'direct', OWNED),
    exportTable(emailSuppressions, 'direct', 'Addresses the tenant must not mail again (bounces, complaints); carried so a move does not resume mailing them.'),
    outTable(smsDeliveryStatus, 'direct', EPHEMERAL),
    exportTable(inspectorServiceAreas, 'direct', OWNED),
    exportTable(contacts, 'direct', 'Business data the tenant owns. The agent link columns are reset to NULL because they point at global agent accounts that do not travel.', {
        reset: {
            agentUserId: 'Id of a global agent account; importing it would link that agent to inspections of another tenant. Set to NULL.',
            agentLinkedAt: 'Belongs to the agent link; set to NULL.',
            agentRevokedAt: 'Belongs to the agent link; set to NULL.',
        },
    }),
    exportTable(contactRoleProfiles, 'direct', OWNED),
    exportTable(contractorTypes, 'direct', OWNED),
    exportTable(invoices, 'direct', 'Company money. Payment-provider ids are carried as inert text; only an owner-level caller may request a package. qbo_sync_status describes a sync with the source accounting company and is imported as unsynced (a dangling soft reference).'),
    archiveTable(orderPayments, 'direct', 'Payment records settled on the source payment account; archived as history, never replayed.'),
    exportTable(servicePayRules, 'direct', OWNED),
    exportTable(inspectionServicePaySplits, 'direct', OWNED),
    exportTable(calendarBlocks, 'direct', OWNED),
    withholdTable(calendarConnections, 'direct', 'OAuth credentials of connected calendars; reconnect on the target.'),
    outTable(calendarConnectionReadCalendars, 'direct', 'Selection state of a withheld connection.'),
    outTable(calendarExternalLinks, 'direct', 'Mapping to external calendar events of a withheld connection.'),
    withholdTable(qboConnections, 'direct', 'Accounting OAuth tokens; reconnect on the target.'),
    outTable(qboEntityMap, 'direct', 'Mapping to the source accounting company; meaningless without the withheld connection.'),
    outTable(qboSyncErrors, 'direct', EPHEMERAL),
    outTable(marketplaceLibraries, 'global', GLOBAL_REASON),
    outTable(tenantLibraryImports, 'direct', BOOKKEEPING),
    outTable(tenantMarketplaceImportHistory, 'direct', BOOKKEEPING),
    exportTable(statutoryFormEntries, 'direct', OWNED),
    archiveTable(statutoryFormProductions, 'direct', 'Produced statutory forms; kept as the record of what was issued. form_id and version point at the global form catalogue and may not resolve on the target; they are kept as text only (dangling soft references).'),
    outTable(statutoryFormSightings, 'global', GLOBAL_REASON),
    outTable(statutoryFormVersions, 'global', GLOBAL_REASON),
    exportTable(statutoryInspectionDetails, 'direct', OWNED),
];
