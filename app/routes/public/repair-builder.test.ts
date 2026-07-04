import { describe, it, expect } from 'vitest';
import { shareViewModel } from '~/routes/public/repair-request.$shareToken';
import { builderCreditTotal, sortDefects, toggleSelected } from '~/routes/public/repair-builder.$tenant.$id';

describe('shareViewModel', () => {
  it('formats credit total and lists items', () => {
    const m = shareViewModel({
      propertyAddress: '1 A St',
      customIntro: 'Please address:',
      creditTotal: 65000,
      items: [
        {
          sectionTitle: 'Roof',
          itemLabel: 'Shingles',
          commentSnapshot: 'worn',
          requestedCreditCents: 50000,
          note: 'replace',
        },
      ],
    });
    expect(m.creditTotalDisplay).toBe('$650.00');
    expect(m.rows.length).toBe(1);
  });

  it('not_published flag renders a not-published state', () => {
    const m = shareViewModel({ notPublished: true } as any);
    expect(m.state).toBe('not_published');
  });

  it('item with null requestedCreditCents shows dash, not $0.00', () => {
    const m = shareViewModel({
      propertyAddress: '2 B Ave',
      customIntro: null,
      creditTotal: 0,
      items: [
        {
          sectionTitle: 'Electrical',
          itemLabel: 'Outlet',
          commentSnapshot: 'sparking',
          requestedCreditCents: null,
          note: null,
        },
      ],
    });
    expect(m.rows[0].creditDisplay).toBe('—');
    expect(m.state).toBe('ok');
  });

  it('empty items list → rows.length === 0 and state === ok', () => {
    const m = shareViewModel({
      propertyAddress: '3 C Blvd',
      customIntro: null,
      creditTotal: 0,
      items: [],
    });
    expect(m.rows.length).toBe(0);
    expect(m.state).toBe('ok');
  });

  it('maps all row fields correctly', () => {
    const m = shareViewModel({
      propertyAddress: '4 D Ct',
      customIntro: 'Fix these:',
      creditTotal: 12500,
      items: [
        {
          sectionTitle: 'Roof',
          itemLabel: 'Gutters',
          commentSnapshot: 'clogged',
          requestedCreditCents: 12500,
          note: 'clean and reseal',
        },
      ],
    });
    const row = m.rows[0];
    expect(row.sectionTitle).toBe('Roof');
    expect(row.itemLabel).toBe('Gutters');
    expect(row.comment).toBe('clogged');
    expect(row.note).toBe('clean and reseal');
    expect(row.creditDisplay).toBe('$125.00');
    expect(m.propertyAddress).toBe('4 D Ct');
    expect(m.customIntro).toBe('Fix these:');
    expect(m.creditTotalDisplay).toBe('$125.00');
  });
});

describe('repair-builder helpers', () => {
  it('builderCreditTotal sums requestedCreditCents, ignoring null/undefined', () => {
    const items = [
      { requestedCreditCents: 5000 },
      { requestedCreditCents: null },
      { requestedCreditCents: 3000 },
      { requestedCreditCents: undefined },
    ];
    expect(builderCreditTotal(items)).toBe(8000);
  });

  it('sortDefects by section groups on sectionTitle alphabetically', () => {
    const defects = [
      { findingKey: 'k1', sectionId: 's1', sectionTitle: 'Roof', itemId: 'i1', itemLabel: 'Shingles', comment: 'worn', category: 'safety' as const },
      { findingKey: 'k2', sectionId: 's2', sectionTitle: 'Attic', itemId: 'i2', itemLabel: 'Insulation', comment: 'missing', category: 'recommendation' as const },
      { findingKey: 'k3', sectionId: 's3', sectionTitle: 'Electrical', itemId: 'i3', itemLabel: 'Panel', comment: 'dated', category: 'maintenance' as const },
    ];
    const sorted = sortDefects(defects, 'section');
    expect(sorted[0].sectionTitle).toBe('Attic');
    expect(sorted[1].sectionTitle).toBe('Electrical');
    expect(sorted[2].sectionTitle).toBe('Roof');
  });

  it('toggleSelected adds key when absent, removes when present', () => {
    const s0 = new Set<string>();
    const s1 = toggleSelected(s0, 'k1');
    expect(s1.has('k1')).toBe(true);
    const s2 = toggleSelected(s1, 'k1');
    expect(s2.has('k1')).toBe(false);
    // Original set is not mutated
    expect(s0.size).toBe(0);
  });
});
