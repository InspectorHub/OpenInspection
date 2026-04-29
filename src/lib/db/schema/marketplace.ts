import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const marketplaceTemplates = sqliteTable('marketplace_templates', {
  id:            text('id').primaryKey(),
  name:          text('name').notNull(),
  category:      text('category').notNull(),
  semver:        text('semver').notNull(),
  schema:        text('schema', { mode: 'json' }).notNull(),
  authorId:      text('author_id').notNull().default('system'),
  changelog:     text('changelog'),
  downloadCount: integer('download_count').notNull().default(0),
  createdAt:     text('created_at').notNull(),
  updatedAt:     text('updated_at').notNull(),
});

export const tenantMarketplaceImports = sqliteTable('tenant_marketplace_imports', {
  id:                    text('id').primaryKey(),
  tenantId:              text('tenant_id').notNull(),
  marketplaceTemplateId: text('marketplace_template_id').notNull().references(() => marketplaceTemplates.id),
  importedSemver:        text('imported_semver').notNull(),
  localTemplateId:       text('local_template_id').notNull(),
  importedAt:            text('imported_at').notNull(),
});
