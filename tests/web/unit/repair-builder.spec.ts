import { describe, it, expect } from 'vitest';
import { shareViewModel } from '~/routes/public/repair-request.$shareToken';

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
