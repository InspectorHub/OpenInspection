import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenant';

export const recommendations = sqliteTable('recommendations', {
    id:                   text('id').primaryKey(),
    tenantId:             text('tenant_id').notNull().references(() => tenants.id),
    category:             text('category'),                                                       // nullable, free text matching comments.category
    name:                 text('name').notNull(),
    severity:             text('severity', { enum: ['satisfactory', 'monitor', 'defect'] }).notNull(),
    defaultEstimateMin:   integer('default_estimate_min'),                                        // USD cents, nullable
    defaultEstimateMax:   integer('default_estimate_max'),                                        // USD cents, nullable
    defaultRepairSummary: text('default_repair_summary').notNull(),
    createdByUserId:      text('created_by_user_id'),                                             // no FK, stale ref acceptable
    createdAt:            integer('created_at', { mode: 'timestamp' }).notNull(),
});
