import { describe, it, expect } from 'vitest';
import { messageTemplates } from '../../server/lib/db/schema';
import { automations } from '../../server/lib/db/schema';
import { getTableConfig } from 'drizzle-orm/sqlite-core';

describe('message_templates schema', () => {
  it('uses the message_templates physical name (not the rating templates table)', () => {
    expect(getTableConfig(messageTemplates).name).toBe('message_templates');
  });

  it('declares the SP2 columns with OI schema rules', () => {
    const cols = Object.fromEntries(getTableConfig(messageTemplates).columns.map((c) => [c.name, c]));
    expect(cols['tenant_id'].notNull).toBe(true);
    expect(cols['name'].notNull).toBe(true);
    expect(cols['channel'].notNull).toBe(true);
    expect(cols['body'].notNull).toBe(true);
    // subject + variables are nullable
    expect(cols['subject'].notNull).toBe(false);
    expect(cols['variables'].notNull).toBe(false);
    // boolean + timestamp_ms columns exist
    expect(cols['is_seeded']).toBeDefined();
    expect(cols['created_at']).toBeDefined();
    expect(cols['updated_at']).toBeDefined();
  });

  it('has a tenant+channel index with the idx_ prefix', () => {
    const idxNames = getTableConfig(messageTemplates).indexes.map((i) => i.config.name);
    expect(idxNames).toContain('idx_message_templates_tenant_channel');
  });

  it('automations expose the new template-reference columns', () => {
    const cols = Object.fromEntries(getTableConfig(automations).columns.map((c) => [c.name, c]));
    expect(cols['email_template_id']).toBeDefined();
    expect(cols['sms_template_id']).toBeDefined();
    expect(cols['email_template_id'].notNull).toBe(false);
    expect(cols['sms_template_id'].notNull).toBe(false);
  });
});
