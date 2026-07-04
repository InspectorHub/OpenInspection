import { describe, it, expect } from 'vitest';
import { statusCardModels } from '../../../app/components/portal/InspectionStatusCards';
import { hubSectionNavHref } from '../../../app/components/portal/InspectionHub';
describe('portal hub models', () => {
  it('statusCardModels renders 6 cards with correct states', () => {
    const cards = statusCardModels({ inspectionStatus:'completed', agreementSigned:true, paymentStatus:'paid', reportPublished:true, progress:{completed:8,total:10}, unreadMessages:2, address:'1 A St', date:'2026-06-16' });
    const byKey = Object.fromEntries(cards.map(c => [c.key, c]));
    expect(byKey.report.value).toMatch(/Published/i);
    expect(byKey.progress.value).toMatch(/8\/10|80%/);
    expect(byKey.messages.badge).toBe(2);
    expect(cards.length).toBe(6);
  });
  it('report card shows Not published when unpublished', () => {
    const cards = statusCardModels({ inspectionStatus:'completed', agreementSigned:false, paymentStatus:'unpaid', reportPublished:false, progress:{completed:0,total:0}, unreadMessages:0, address:'', date:'' });
    expect(cards.find(c=>c.key==='report')!.value).toMatch(/Not published/i);
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
