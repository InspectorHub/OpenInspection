import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * One order, several reports.
 *
 * A standard inspection publishes today and the radon report publishes on
 * Thursday, each with its own document, signature chain and notification —
 * without the client waiting on the slowest one. Before this, `inspections` and
 * `inspection_results` were one-to-one (`uq_results_inspection`), so an order
 * could only ever produce a single document.
 *
 * A report's identity comes from its SERVICE and its TEMPLATE. There is
 * deliberately no third catalogue: `services` and `event_types` stay separate
 * because one service can require two visits (a radon drop-off and a pickup),
 * which is a different question from what gets delivered.
 */
export const reports = sqliteTable('reports', {
    id:           text('id').primaryKey(),
    tenantId:     text('tenant_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    // 'primary' is not just another ancillary: it is the one that must exist,
    // the one the pay gate keys on, and the one a client means by "my report".
    kind:         text('kind', { enum: ['primary', 'ancillary'] }).notNull(),
    // The billing LINE this delivers (`inspection_services.id`), when there is
    // one. Nullable and NOT a foreign key: a tenant may produce a report for
    // something they did not bill separately.
    //
    // NOT named `service_id`, on purpose. In this schema `service_id` already
    // means the CATALOGUE entry (`services.id`) — both
    // `inspection_services.service_id` and `service_inspectors.service_id` are
    // that. Naming this one `service_id` would read as the catalogue to anyone
    // who has seen the other two, and a catalogue id here makes "which report
    // did this billing line produce" unanswerable — which breaks pay splits,
    // whose entire grain is `inspection_services.id`.
    inspectionServiceId: text('inspection_service_id'),
    // Denormalised pointer to the template this report was generated from, the
    // same treatment `inspections.template_id` keeps for the primary report.
    templateId:   text('template_id'),
    title:        text('title').notNull(),
    status:       text('status', { enum: ['in_progress', 'published'] }).notNull().default('in_progress'),
    createdAt:    integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_reports_inspection').on(t.inspectionId),
    index('idx_reports_tenant').on(t.tenantId),
    // Exactly one primary per inspection, enforced by the database rather than
    // by the service layer: "which one does the client mean" must not depend on
    // which caller wrote last. Partial index — ancillary reports are unbounded.
    uniqueIndex('uq_reports_primary').on(t.inspectionId).where(sql`kind = 'primary'`),
]);
