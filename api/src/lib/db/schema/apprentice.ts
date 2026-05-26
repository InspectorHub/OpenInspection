/**
 * Design System 0520 subsystem C phase 1 — ApprenticeReview queue.
 *
 * One row per item-field write submitted by an apprentice; mentor
 * approves / rejects / edits each row before the value lands in
 * inspection_results.data.
 *
 * status:
 *   - 'pending'   — apprentice submitted, awaiting mentor
 *   - 'approved'  — mentor accepted the apprentice's value
 *   - 'rejected'  — mentor discarded; no write to inspection_results
 *   - 'edited'   — mentor modified before applying; decision_value carries
 *                   the final stored value
 */
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const apprenticeReviews = sqliteTable('apprentice_reviews', {
    id:             text('id').primaryKey(),
    tenantId:       text('tenant_id').notNull(),
    apprenticeId:   text('apprentice_id').notNull(),
    mentorId:       text('mentor_id').notNull(),
    inspectionId:   text('inspection_id').notNull(),
    itemId:         text('item_id').notNull(),
    field:          text('field').notNull(),
    proposedValue:  text('proposed_value'),
    status:         text('status', { enum: ['pending', 'approved', 'rejected', 'edited'] }).notNull().default('pending'),
    decisionValue:  text('decision_value'),
    decisionAt:     integer('decision_at'),
    submittedAt:    integer('submitted_at').notNull(),
    createdAt:      text('created_at').notNull(),
});
