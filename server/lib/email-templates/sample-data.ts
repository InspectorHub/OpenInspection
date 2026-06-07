import type { EmailTemplateDescriptor } from './types';

const EXAMPLES: Record<string, string> = {
  address: '123 Main St', propertyAddress: '123 Main St',
  reportUrl: 'https://app.example.com/r/abc123', signUrl: 'https://app.example.com/sign/abc123',
  verifyUrl: 'https://app.example.com/verify/abc123', confirmUrl: 'https://app.example.com/confirm/abc123',
  reviewUrl: 'https://app.example.com/review/abc123', dashboardUrl: 'https://app.example.com/dashboard',
  viewUrl: 'https://app.example.com/messages/abc123', acceptUrl: 'https://app.example.com/accept/abc123',
  payUrl: 'https://app.example.com/r/abc123/invoice',
  inviteLink: 'https://app.example.com/join/abc123', resetLink: 'https://app.example.com/reset/abc123',
  clientName: 'Jordan Smith', inspectorName: 'Alex Rivera', agentName: 'Pat Lee',
  tenantName: 'Acme Inspections', agreementName: 'Inspection Agreement',
  date: 'July 1, 2026', time: '3:00 PM', amount: '$350.00',
  confirmationId: 'A1B2C3', signedAtUtc: '2026-07-01T15:00:00Z', ipAddress: '203.0.113.7',
  fromName: 'Alex Rivera', snippet: 'Thanks — see you then!', envelopeId: 'ENV-12345',
};

/** Phase 3 — sample values for every declared variable, used by template preview. */
export function sampleDataFor(descriptor: EmailTemplateDescriptor): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of descriptor.variables) out[v.name] = EXAMPLES[v.name] ?? `{${v.name}}`;
  out.icsAttached = 'true'; // so booking-confirmation preview shows the ics hint
  return out;
}
