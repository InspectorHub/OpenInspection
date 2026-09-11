/**
 * Unified client-portal wire schemas (`/api/portal/:tenant/...`).
 *
 * Moved out of `server/api/portal.ts` because that file sits at the file-size
 * ratchet's cap and the Hub overview is the payload that grows: every fact the
 * Hub has to stop guessing at becomes a field here. Same declarations, same
 * OpenAPI output — the route file imports them.
 *
 * Every field carries a `.describe()` (repo convention, and the MCP tool
 * descriptions are generated from them).
 */
import { z } from '@hono/zod-openapi';

export const RecipientInspectionSchema = z.object({
    inspectionId:     z.string().describe('Inspection identifier the recipient can access.'),
    address:          z.string().describe('Property address for the inspection.'),
    date:             z.string().describe('Inspection date (ISO date string).'),
    inspectionStatus: z.string().describe('Lifecycle status of the inspection.'),
    reportPublished:  z.boolean().describe('Whether the report has been published.'),
    paymentStatus:    z.string().describe('Payment status of the inspection.'),
});

/** Not exported: only `HubOverviewResponseSchema` below extends it, and an
 *  exported schema with no importer is a public surface nobody asked for. */
const HubOverviewSchema = z.object({
    address:          z.string().describe('Property address for the inspection.'),
    date:             z.string().describe('Inspection date (ISO date string).'),
    inspectionStatus: z.string().describe('Lifecycle status of the inspection.'),
    agreementSigned:  z.boolean().describe('Whether the inspection agreement is signed.'),
    paymentStatus:    z.string().describe('Payment status of the inspection.'),
    reportPublished:  z.boolean().describe('Whether the report has been published.'),
    progress:         z.object({
        completed: z.number().describe('Number of completed report items.'),
        total:     z.number().describe('Total number of report items.'),
    }).describe('Observation progress for the inspection report.'),
    unreadMessages:   z.number().describe('Count of unread inspector messages.'),
    // ---------------------------------------------------------------------
    // WHAT THE GATE ACTUALLY IS. The Hub used to decide "your report is locked"
    // from `agreementSigned` / `paymentStatus` alone, which says nothing about
    // whether this inspection HAS either gate switched on. Both columns default
    // to false, so an inspection that requires neither still rendered "Sign the
    // inspection agreement to unlock your report" beside a fully readable
    // report. The server's own gate (InspectionPublishService.getReportGate)
    // reads these three, and so must the page.
    // ---------------------------------------------------------------------
    agreementRequired: z.boolean().describe('Whether THIS inspection gates its report behind a signed agreement (inspections.is_agreement_required). False = no agreement is owed and none may be implied.'),
    paymentRequired:   z.boolean().describe('Whether THIS inspection gates its report behind payment (inspections.is_payment_required).'),
    reportUnlocked:    z.boolean().describe('Whether a named person manually released the order-wide report gate (inspections.unlocked_at). True = no gate applies regardless of the two flags above.'),
    hasInvoice:        z.boolean().describe('Whether a live (non-voided) invoice exists for this inspection. False = there is nothing to pay, so an "Unpaid" badge would overstate the state.'),
    repairRequestEnabled: z.boolean().describe('Whether the repair-request builder is enabled for this company (tenant_configs.is_customer_repair_export_enabled) — the SAME column runBuilderGate enforces. False = every builder endpoint refuses, so the Hub must not advertise the tab.'),
});

export const HubOverviewResponseSchema = HubOverviewSchema.extend({
    token: z.string().describe('Persistent per-inspection access token for building section deep-links.'),
    signerToken: z.string().nullable().describe("The recipient's OWN agreement signer token (email-matched) for the inline Agreement section. Null when the recipient is not a signer."),
});

export const ObserveSchema = z.object({
    address:        z.string().describe('Property address for the inspection.'),
    date:           z.string().nullable().describe('Inspection date (ISO date string), or null.'),
    inspectorName:  z.string().describe('Name of the assigned inspector.'),
    status:         z.string().describe('Lifecycle status of the inspection.'),
    sections:       z.array(z.object({
        name:           z.string().describe('Section title.'),
        totalItems:     z.number().describe('Total number of items in the section.'),
        completedItems: z.number().describe('Number of completed items in the section.'),
    })).describe('Per-section observation progress.'),
});
