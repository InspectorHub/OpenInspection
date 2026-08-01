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

/**
 * The two sends the ROUTES used to build by hand.
 *
 * Each one shipped a hardcoded slate button (`#0f172a`) that ignored the
 * company's colour and logo, could not be edited or translated, and reached the
 * send boundary with no notification class. Being a template is what fixes all
 * four at once, so these assert all four.
 */
describe('sends converted off hand-built HTML', () => {
  /** Captures what reached the boundary, including the class the routes lacked. */
  class Probe extends EmailService {
    captured: Array<{ to: string[]; subject: string; html: string; classId?: string }> = [];
    override async sendEmail(
      to: string[], subject: string, html: string,
      _attachments?: Array<{ filename: string; content: ArrayBuffer | string; contentType?: string }>,
      opts?: { classId?: string },
    ): Promise<{ delivered: boolean }> {
      this.captured.push({ to, subject, html, classId: opts?.classId });
      return { delivered: true };
    }
  }
  const probe = () => new Probe('re_test', 'reports@acme.com', 'Acme', undefined, renderer);

  it('client portal sign-in: tenant-branded, carries the link and its class', async () => {
    const p = probe();
    await p.sendClientPortalLogin('a@x.com', 'https://x/portal/acme/auth?link=tok');
    expect(p.captured[0].classId).toBe('client-portal-login');
    expect(p.captured[0].subject).toBe('Sign in to your client portal');
    expect(p.captured[0].html).toContain('https://x/portal/acme/auth?link=tok');
    // Tenant brand, not the platform's — a client's portal belongs to one company.
    expect(p.captured[0].html).toContain('Acme');
    expect(p.captured[0].html).not.toContain('#0f172a;">Open my portal');
  });

  it('repair-request share: subject carries the address, body the note and the link', async () => {
    const p = probe();
    await p.sendRepairRequestShare('contractor@x.com', {
      propertyAddress: '12 Elm St',
      shareUrl: 'https://x/repair-request/tok',
      message: 'Please quote items 2 and 3.\nThanks.',
    });
    expect(p.captured[0].classId).toBe('repair-request-share');
    expect(p.captured[0].subject).toBe('Repair request — 12 Elm St');
    expect(p.captured[0].html).toContain('https://x/repair-request/tok');
    // The sender's newline survives — they typed it into a textarea.
    expect(p.captured[0].html).toContain('Please quote items 2 and 3.<br />Thanks.');
  });

  it('repair-request share with no note leaves no empty block behind', async () => {
    const p = probe();
    await p.sendRepairRequestShare('contractor@x.com', {
      propertyAddress: '12 Elm St',
      shareUrl: 'https://x/repair-request/tok',
    });
    expect(p.captured[0].html).not.toMatch(/<p[^>]*>\s*<\/p>/);
  });

  it('falls back to "your property" rather than a subject ending in a dash', async () => {
    const p = probe();
    await p.sendRepairRequestShare('contractor@x.com', { propertyAddress: '', shareUrl: 'https://x/s' });
    expect(p.captured[0].subject).toBe('Repair request — your property');
  });
});
