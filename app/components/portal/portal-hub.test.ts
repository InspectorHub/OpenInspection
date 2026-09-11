import { describe, it, expect } from 'vitest';
import { statusCardModels, reportLockNotice } from '../../../app/components/portal/InspectionStatusCards';
import { hubSectionNavHref, hubNavItems } from '../../../app/components/portal/ClientPortalHub';
// Static, not a dynamic import inside the test body: a module import in a test
// is billed against testTimeout, while collection has no timeout at all.
import { m } from '../../../app/paraglide/messages';

/**
 * A complete overview, because every one of these models now reads the gate
 * SWITCHES as well as the gate states and a partial literal would silently mean
 * "no gate" (see reportLockNotice's header). Each case overrides only what it is
 * about.
 *
 * Defaults are the production-common shape: 36 of 37 inspections require no
 * agreement, 0 of 26 companies have the repair builder on.
 */
const BASE = {
  inspectionStatus: 'completed',
  agreementSigned: false,
  paymentStatus: 'unpaid',
  reportPublished: true,
  progress: { completed: 10, total: 10 },
  unreadMessages: 0,
  address: '',
  date: '',
  agreementRequired: false,
  paymentRequired: false,
  reportUnlocked: false,
  hasInvoice: false,
  repairRequestEnabled: false,
};

describe('portal hub models', () => {
  it('statusCardModels renders 6 cards with correct states', () => {
    const cards = statusCardModels({ ...BASE, agreementSigned:true, paymentStatus:'paid', progress:{completed:8,total:10}, unreadMessages:2, address:'1 A St', date:'2026-06-16' });
    const byKey = Object.fromEntries(cards.map(c => [c.key, c]));
    expect(byKey.report.value).toMatch(/Published/i);
    expect(byKey.progress.value).toMatch(/8\/10|80%/);
    expect(byKey.messages.badge).toBe(2);
    expect(cards.length).toBe(6);
  });
  it('report card shows Not published when unpublished', () => {
    const cards = statusCardModels({ ...BASE, reportPublished:false, progress:{completed:0,total:0} });
    expect(cards.find(c=>c.key==='report')!.value).toMatch(/Not published/i);
  });

  // A published report the client cannot open yet is not "Published" from the
  // client's seat. The Hub renders the lock notice ("Your report isn't
  // available yet") directly above these cards, so a green "Published" tile
  // beneath it told the client two opposite things at once.
  it('report card does not claim Published while the agreement still gates it', () => {
    const cards = statusCardModels({ ...BASE, agreementRequired:true });
    const report = cards.find(c=>c.key==='report')!;
    expect(report.value).not.toMatch(/^Published$/i);
    expect(report.value).toMatch(/sign/i);
    expect(report.tone).not.toBe('ok');
  });

  it('report card names the payment gate when signed but unpaid', () => {
    const cards = statusCardModels({ ...BASE, agreementSigned:true, paymentRequired:true, hasInvoice:true });
    const report = cards.find(c=>c.key==='report')!;
    expect(report.value).not.toMatch(/^Published$/i);
    expect(report.value).toMatch(/payment/i);
    expect(report.tone).not.toBe('ok');
  });

  // POSITIVE CONTROL for the two assertions above: with nothing outstanding the
  // tile must still read plainly "Published" in the ok tone. Without this, an
  // implementation that reported "locked" unconditionally would pass.
  it('report card still says Published when nothing gates it', () => {
    const cards = statusCardModels({ ...BASE, agreementSigned:true, paymentStatus:'paid' });
    const report = cards.find(c=>c.key==='report')!;
    expect(report.value).toMatch(/^Published$/i);
    expect(report.tone).toBe('ok');
  });
  it('hubSectionNavHref builds inline ?section= nav targets on the hub page', () => {
    expect(hubSectionNavHref('report', { tenant:'t', inspectionId:'i', token:'k' }))
      .toBe('/portal/t/i/i?section=report&token=k');
    expect(hubSectionNavHref('payment', { tenant:'t', inspectionId:'i', token:'k' }))
      .toBe('/portal/t/i/i?section=payment&token=k');
    // "overview" is the default → no ?section param; token still preserved.
    expect(hubSectionNavHref('overview', { tenant:'t', inspectionId:'i', token:'k' }))
      .toBe('/portal/t/i/i?token=k');
    // No token → clean URL with no query when overview.
    expect(hubSectionNavHref('overview', { tenant:'t', inspectionId:'i', token:'' }))
      .toBe('/portal/t/i/i');
  });
});

describe('reportLockNotice (IA-45)', () => {
  /**
   * F23 — THE ONE THAT WAS WRONG IN PRODUCTION, and it is the default case.
   *
   * `is_agreement_required = 0`, `agreement_requests = 0`: this inspection never
   * asked for an agreement and none exists. The banner still read "Your report
   * isn't available yet — Sign the inspection agreement to unlock your report",
   * and its CTA switched to an Agreement section with nothing in it, while the
   * Report tab beside it served all 40 items. 36 of 37 production inspections are
   * in this state, so the false banner was what nearly every client saw.
   */
  it('no notice when the inspection requires no agreement and no payment', () => {
    expect(reportLockNotice({
      agreementSigned: false, paymentStatus: 'unpaid',
      agreementRequired: false, paymentRequired: false, reportUnlocked: false,
    })).toBeNull();
  });

  it('agreement gate takes precedence when required and unsigned', () => {
    expect(reportLockNotice({
      agreementSigned: false, paymentStatus: 'unpaid',
      agreementRequired: true, paymentRequired: true, reportUnlocked: false,
    })).toEqual({ reason: 'agreement', section: 'agreement' });
  });
  it('payment gate when signed but unpaid', () => {
    expect(reportLockNotice({
      agreementSigned: true, paymentStatus: 'unpaid',
      agreementRequired: true, paymentRequired: true, reportUnlocked: false,
    })).toEqual({ reason: 'payment', section: 'payment' });
  });
  it('partial payment still gates', () => {
    expect(reportLockNotice({
      agreementSigned: true, paymentStatus: 'partial',
      agreementRequired: false, paymentRequired: true, reportUnlocked: false,
    })).toEqual({ reason: 'payment', section: 'payment' });
  });
  it('no notice once signed and paid (case-insensitive)', () => {
    expect(reportLockNotice({
      agreementSigned: true, paymentStatus: 'Paid',
      agreementRequired: true, paymentRequired: true, reportUnlocked: false,
    })).toBeNull();
  });

  // A payment gate is not an agreement gate. An unsigned agreement on an
  // inspection that only gates on payment must route to Payment, or the client is
  // sent to sign something nobody asked for — the F23 failure one column over.
  it('an unsigned agreement nobody required does not produce an agreement notice', () => {
    expect(reportLockNotice({
      agreementSigned: false, paymentStatus: 'unpaid',
      agreementRequired: false, paymentRequired: true, reportUnlocked: false,
    })).toEqual({ reason: 'payment', section: 'payment' });
  });

  // `unlocked_at` is the inspector releasing the order-wide gate, with a name and
  // a reason recorded. The server gate returns null on it before looking at
  // either flag; so does this.
  it('a manual unlock releases both gates', () => {
    expect(reportLockNotice({
      agreementSigned: false, paymentStatus: 'unpaid',
      agreementRequired: true, paymentRequired: true, reportUnlocked: true,
    })).toBeNull();
  });
});

/**
 * F25 — the PAYMENT tile said "Unpaid" in a warning colour while the Payment tab
 * one click away said "No invoice yet". `payment_status` is 'unpaid' from
 * creation, invoice or no invoice, so the tile was reporting a debt nobody had
 * billed.
 */
describe('payment status card', () => {
  it('says there is no invoice, in no alarming colour, when none exists', () => {
    const card = statusCardModels({ ...BASE, paymentStatus: 'unpaid', hasInvoice: false })
      .find(c => c.key === 'payment')!;
    expect(card.value).not.toMatch(/unpaid/i);
    expect(card.value).toMatch(/no invoice/i);
    expect(card.tone).toBe('neutral');
  });

  // POSITIVE CONTROL: a real unpaid invoice must still nudge. Without this, a
  // tile hard-coded to "No invoice" would pass the case above.
  it('still says Unpaid, in the warn tone, when an invoice is outstanding', () => {
    const card = statusCardModels({ ...BASE, paymentStatus: 'unpaid', hasInvoice: true })
      .find(c => c.key === 'payment')!;
    expect(card.value).toMatch(/unpaid/i);
    expect(card.tone).toBe('warn');
  });

  it('paid is paid, invoice row or not', () => {
    const card = statusCardModels({ ...BASE, paymentStatus: 'paid', hasInvoice: true })
      .find(c => c.key === 'payment')!;
    expect(card.value).toMatch(/paid/i);
    expect(card.tone).toBe('ok');
  });
});

/** F23's other half: the AGREEMENT tile read "Not signed" in a warning colour on
 *  an inspection with no agreement to sign. */
describe('agreement status card', () => {
  it('says Not required when this inspection has no agreement gate', () => {
    const card = statusCardModels({ ...BASE, agreementSigned: false, agreementRequired: false })
      .find(c => c.key === 'agreement')!;
    expect(card.value).toMatch(/not required/i);
    expect(card.tone).toBe('neutral');
  });

  // POSITIVE CONTROL: when one IS required and unsigned, it is still an open
  // obligation and still warns.
  it('says Not signed, in the warn tone, when one is required', () => {
    const card = statusCardModels({ ...BASE, agreementSigned: false, agreementRequired: true })
      .find(c => c.key === 'agreement')!;
    expect(card.value).toMatch(/not signed/i);
    expect(card.tone).toBe('warn');
  });

  it('a signed agreement reads Signed whether or not it was required', () => {
    for (const agreementRequired of [true, false]) {
      const card = statusCardModels({ ...BASE, agreementSigned: true, agreementRequired })
        .find(c => c.key === 'agreement')!;
      expect(card.value).toMatch(/signed/i);
      expect(card.tone).toBe('ok');
    }
  });
});

/**
 * F24 — the Hub navigation offered a "Repair Request" tab to every client. Every
 * repair-builder endpoint runs `runBuilderGate`, which refuses unless
 * `is_customer_repair_export_enabled` is on; it is on for 1 of 26 production
 * companies, so for the other 25 the tab was a label for a capability that does
 * not exist, answering "Feature Not Available" after the click.
 */
describe('hubNavItems', () => {
  it('omits the Repair Request tab when the builder is not enabled', () => {
    const sections = hubNavItems({ repairRequestEnabled: false }).map(n => n.section);
    expect(sections).not.toContain('repair');
    // The other seven are untouched — this hides one tab, not the nav.
    expect(sections).toEqual(['overview','report','agreement','payment','progress','messages','documents']);
  });

  // POSITIVE CONTROL: the tab is the only path to the real builder, so a nav that
  // dropped it unconditionally would be a worse bug than the one being fixed.
  it('offers the Repair Request tab when the builder IS enabled', () => {
    const items = hubNavItems({ repairRequestEnabled: true });
    expect(items.map(n => n.section)).toContain('repair');
    // And it keeps its position between Messages and Documents.
    expect(items.map(n => n.section)).toEqual(['overview','report','agreement','payment','progress','messages','repair','documents']);
  });

  /**
   * THE NAME IS THE DEFECT, not just the gating. The report page's own toggle
   * opens a client-side selection panel that prints; it reached the inspector
   * never. Under the tab's label, a client who ticked boxes and pressed it
   * believed they had filed a repair request — `repair_requests` gained zero
   * rows. Two controls, two behaviours, one name.
   */
  it('the Repair Request tab label is not reused by the report page toggle', () => {
    expect(m.portal_report_selection_title()).not.toBe(m.portal_hub_nav_repair());
  });
});
