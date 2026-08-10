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
    // When THIS deliverable went out. `inspections.report_status` is the
    // order-wide roll-up and cannot answer "when did the radon report ship",
    // which is the question a client waiting on one of several documents is
    // actually asking. NULL = not published.
    // Appended at table end for D1 rebuild safety.
    publishedAt:  integer('published_at', { mode: 'timestamp_ms' }),
    // When a publish of THIS report actually raised a notification.
    //
    // Not the same instant as `published_at`, and that difference is the whole
    // point: a standard report and a sewer scope finished in one sitting are one
    // delivery to the client, so the second publish coalesces into the first and
    // leaves this NULL. A report published two days later announces itself,
    // which is the reason the client waited. See
    // `lib/inspection/report-notifications.ts` for the window.
    notifiedAt:   integer('notified_at', { mode: 'timestamp_ms' }),
    // Presentation order within one order. Reports are generated from the sold
    // service lines, and the sequence a tenant put their catalogue in is the
    // sequence they think of the work in — an ordering by `created_at` alone
    // ties when several rows are written in the same millisecond, which is
    // exactly what generation does.
    sortOrder:    integer('sort_order').notNull().default(0),
    // The inspector's own prose about this deliverable AS A WHOLE — the
    // paragraph a reader meets before the section-by-section findings. Until
    // this column existed the residential report had no report-level narrative
    // anywhere: every word of prose belonged to one item, so there was nothing
    // that spoke about the property as a single thing.
    //
    // ⚠️ NOT NAMED `summary`, and the reason is two tables away.
    // `report_versions.summary` already exists and does NOT mean "a summary of
    // the report" — it is the per-publish AMENDMENT REASON, surfaced as
    // `reason` in the amendment trail on the client report page
    // (`inspection-report.service.ts`: "Reason reuses report_versions.summary").
    // A second column called `summary`, one join away, meaning something else
    // entirely, is a name that reads as correct at every call site that gets it
    // wrong. `inspector_` says WHO writes it, which is the fact that actually
    // constrains the field: it carries professional liability, so a model may
    // draft it but may never BE it. `narrative` says what it is — continuous
    // prose, not a computed roll-up of the findings.
    //
    // ⚠️ NOT AN ITEM, either. `ItemType` has nine members and none is a
    // narrative type; a `textarea` item would be the closest fit and is the
    // wrong home, because items ARE the inspection's data points — they feed
    // the rating statistics and the defect filters
    // (`inspection-analytics.service.ts` counts an item as captured once it has
    // a rating or a value). Prose about the whole report stored as an item
    // would be counted as one more thing that was inspected.
    //
    // Nullable: a report with no narrative is the normal starting state, and an
    // empty string would be indistinguishable from one the inspector cleared.
    // Model-assisted drafts are evidenced in `ai_content_reviews` with
    // `artifact_type = 'report'` and this row's id — see `schema/ai.ts`.
    // Appended at table end for D1 rebuild safety.
    inspectorNarrative: text('inspector_narrative'),
}, (t) => [
    index('idx_reports_inspection').on(t.inspectionId),
    index('idx_reports_tenant').on(t.tenantId),
    // Exactly one primary per inspection, enforced by the database rather than
    // by the service layer: "which one does the client mean" must not depend on
    // which caller wrote last. Partial index — ancillary reports are unbounded.
    uniqueIndex('uq_reports_primary').on(t.inspectionId).where(sql`kind = 'primary'`),
]);
