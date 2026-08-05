// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { smsSegmentsClient, groupTemplateVariants } from '~/routes/settings-communication-templates';

type Row = Parameters<typeof groupTemplateVariants>[0][number];
const row = (over: Partial<Row> & Pick<Row, 'id' | 'name' | 'locale'>): Row => ({
  tenantId: 't', channel: 'email', subject: null, body: 'b', variables: [],
  isSeeded: false, createdAt: 0, updatedAt: 0, ...over,
});

// The route module exports a tiny pure helper used by the SMS editor so it is
// unit-testable without a DOM. (Mirror server smsSegmentInfo thresholds.)
describe('settings-communication-templates client helpers', () => {
  it('smsSegmentsClient matches the carrier thresholds', () => {
    expect(smsSegmentsClient('')).toBe(0);
    expect(smsSegmentsClient('short')).toBe(1);
    expect(smsSegmentsClient('a'.repeat(161))).toBe(2);
  });

  // The list is what tells a tenant their Spanish clients are getting English.
  // Every case below is seeded so a WRONG grouping produces a different,
  // observable answer -- the Spanish row first, so an implementation that
  // trusted arrival order would name the wrong base.
  describe('groupTemplateVariants', () => {
    it('groups language versions of one template into one row', () => {
      const groups = groupTemplateVariants([
        row({ id: 'es', name: 'Reminder', locale: 'es-419', createdAt: 2 }),
        row({ id: 'en', name: 'Reminder', locale: 'en', createdAt: 1 }),
      ]);
      expect(groups).toHaveLength(1);
      expect(groups[0].variants.map((v) => v.id)).toEqual(['en', 'es']);
      expect(groups[0].base.id).toBe('en');
      expect(groups[0].missing).toEqual([]);
    });

    it('names the languages a template has NOT been written in', () => {
      const groups = groupTemplateVariants([row({ id: 'en', name: 'Reminder', locale: 'en' })]);
      expect(groups[0].missing).toEqual(['es-419']);
    });

    it('never merges two channels that share a name', () => {
      // An SMS "Reminder" is not a translation of the email one; merging them
      // would offer to "add Spanish" to a template that already has it.
      const groups = groupTemplateVariants([
        row({ id: 'sms-en', name: 'Reminder', locale: 'en', channel: 'sms' }),
        row({ id: 'email-en', name: 'Reminder', locale: 'en', channel: 'email' }),
      ]);
      expect(groups).toHaveLength(2);
      expect(groups.every((g) => g.missing.includes('es-419'))).toBe(true);
    });

    it('lists a duplicate language rather than hiding it', () => {
      // Nothing enforces uniqueness on (name, channel, locale). A group that
      // collapsed duplicates would leave the tenant unable to see -- or delete
      // -- the row the send path is not using.
      const groups = groupTemplateVariants([
        row({ id: 'a', name: 'Reminder', locale: 'en', createdAt: 1 }),
        row({ id: 'b', name: 'Reminder', locale: 'en', createdAt: 2 }),
      ]);
      expect(groups[0].variants.map((v) => v.id)).toEqual(['a', 'b']);
      expect(groups[0].missing).toEqual(['es-419']);
    });
  });
});
