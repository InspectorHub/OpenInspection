import { describe, it, expect } from 'vitest';
import { statusCardModels } from '../../../app/components/portal/InspectionStatusCards';
import { hubSectionHref } from '../../../app/components/portal/InspectionHub';
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
  it('hubSectionHref builds interim deep-links to existing pages (phase ①)', () => {
    expect(hubSectionHref('report', { tenant:'t', inspectionId:'i', token:'k' })).toContain('/report/');
    expect(hubSectionHref('payment', { tenant:'t', inspectionId:'i', token:'k' })).toContain('/r/i/invoice');
  });
});
