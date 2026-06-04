import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailService } from '../../../server/services/email.service';
import { EmailTemplateRenderer } from '../../../server/lib/email-templates/renderer';
import type { IcsEvent } from '../../../server/lib/ics';

const renderer = new EmailTemplateRenderer({
  tenantBrand: { name: 'Acme', logoUrl: null, primaryColor: '#F55A1A' },
  platformBrand: { name: 'OpenInspection', logoUrl: null, primaryColor: '#4f46e5' },
});

describe('EmailService rendered path', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(async () => new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it('sends a branded, variable-substituted report-ready email', async () => {
    const svc = new EmailService('re_test', 'reports@acme.com', 'Acme', undefined, renderer);
    await svc.sendReportReady('c@x.com', '12 Elm St', 'https://x/report');
    const body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);
    expect(body.subject).toBe('Property Inspection Report: 12 Elm St');
    expect(body.html).toContain('12 Elm St');
    expect(body.html).toContain('https://x/report');
    expect(body.html).toContain('Acme');
  });

  it('without a renderer, still sends via the inline fallback (no throw)', async () => {
    const svc = new EmailService('re_test', 'reports@acme.com', 'Acme');
    await svc.sendReportReady('c@x.com', '9 Oak', 'https://x/r2');
    expect(fetchMock).toHaveBeenCalled();
    const body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);
    expect(body.subject).toBe('Property Inspection Report: 9 Oak');
  });

  it('keeps the PDF attachment on report-ready-pdf in the rendered path', async () => {
    const svc = new EmailService('re_test', 'reports@acme.com', 'Acme', undefined, renderer);
    await svc.sendInspectionReportPdf('c@x.com', '12 Elm', 'https://x/r', new ArrayBuffer(8));
    const body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);
    expect(Array.isArray(body.attachments)).toBe(true);
    expect(body.attachments.length).toBe(1);
  });

  it('keeps the ICS attachment + emits the ics hint only when an event is attached', async () => {
    const svc = new EmailService('re_test', 'reports@acme.com', 'Acme', undefined, renderer);
    const ics: IcsEvent = {
      uid: 'u1',
      summary: 'Inspection',
      start: new Date('2026-07-01T15:00:00Z'),
      end: new Date('2026-07-01T17:00:00Z'),
      description: '',
      location: '12 Elm',
      organizerEmail: 'inspector@acme.com',
      organizerName: 'Jane Inspector',
    };
    await svc.sendBookingConfirmation('c@x.com', 'Jo', '12 Elm', '2026-07-01', '3pm', ics);
    const body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);
    expect(Array.isArray(body.attachments)).toBe(true);
    expect(body.html).toContain('inspection.ics');
  });

  it('omits the ics hint when no event is attached', async () => {
    const svc = new EmailService('re_test', 'reports@acme.com', 'Acme', undefined, renderer);
    await svc.sendBookingConfirmation('c@x.com', 'Jo', '12 Elm', '2026-07-01', '3pm');
    const body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);
    expect(body.html).not.toContain('inspection.ics');
  });
});
