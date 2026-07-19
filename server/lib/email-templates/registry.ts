import type { EmailTemplateDescriptor } from './types';

export const REGISTRY: EmailTemplateDescriptor[] = [
  // ─── system ───────────────────────────────────────────────────────────────
  {
    trigger: 'password-reset',
    name: 'Password reset',
    category: 'system',
    editable: false,
    required: false,
    brand: 'platform',
    defaultSubject: 'Reset your password',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'Reset your password',                                                                              multiline: false },
      { key: 'body',     label: 'Body',    default: 'Click the button below to reset your password. This link expires in 1 hour.',                      multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'Reset Password',                                                                                   multiline: false },
    ],
    variables: [
      { name: 'resetLink', desc: 'Password-reset link' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'resetLink' },
  },

  {
    trigger: 'workspace-invitation',
    name: 'Workspace invitation',
    category: 'system',
    editable: true,
    required: false,
    brand: 'tenant',
    defaultSubject: "You've been invited to join a workspace",
    blocks: [
      { key: 'heading',  label: 'Heading', default: "You're invited",                                                                                                  multiline: false },
      { key: 'body',     label: 'Body',    default: "You've been invited to join the {{tenantName}} workspace. Accept the invitation to get started.",                  multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'Accept Invitation',                                                                                               multiline: false },
    ],
    variables: [
      { name: 'inviteLink',  desc: 'Invitation acceptance link' },
      { name: 'tenantName',  desc: 'Workspace name' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'inviteLink' },
  },

  // ─── agent ────────────────────────────────────────────────────────────────
  {
    trigger: 'agent-invite',
    name: 'Partner agent invite',
    category: 'agent',
    editable: true,
    required: false,
    brand: 'tenant',
    defaultSubject: '{{inspectorName}} invited you to be a partner agent',
    blocks: [
      { key: 'heading',  label: 'Heading', default: "You're invited",                                                                                                                                       multiline: false },
      { key: 'body',     label: 'Body',    default: '{{inspectorName}} at {{tenantName}} has invited you to be a partner agent. Accept to see inspections for clients you refer.',                          multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'Accept Invitation',                                                                                                                                    multiline: false },
    ],
    variables: [
      { name: 'inspectorName', desc: 'Inspector\'s name' },
      { name: 'tenantName',    desc: 'Workspace / company name' },
      { name: 'acceptUrl',     desc: 'Invitation acceptance link' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'acceptUrl' },
  },

  {
    // Spec 3 Task 5 — agent-login-link is minted by requestMagicLoginByEmail
    // (server/services/agent/magic-login.service.ts) and sent by
    // EmailService.sendAgentLoginLink (server/services/email/agent.ts) for
    // the core /agent-login page's magic-link fallback. Bare account-level
    // sign-in with no tenant context (agents are global users), so brand:
    // 'platform' — mirrors 'password-reset' above, not the tenant-branded
    // 'agent-invite'/'agent-share-link' entries below.
    trigger: 'agent-login-link',
    name: 'Agent sign-in link',
    category: 'agent',
    editable: true,
    required: false,
    brand: 'platform',
    defaultSubject: 'Sign in to your agent account',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'Sign in to your agent account',                                                    multiline: false },
      { key: 'body',     label: 'Body',    default: 'Click the button below to sign in. This link expires in 15 minutes and can only be used once.', multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'Sign in',                                                                           multiline: false },
    ],
    variables: [
      { name: 'loginUrl', desc: 'One-time agent sign-in link' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'loginUrl' },
  },

  // ─── client ───────────────────────────────────────────────────────────────
  {
    trigger: 'agent-share-link',
    name: 'Agent report share',
    category: 'client',
    editable: true,
    required: false,
    brand: 'tenant',
    defaultSubject: 'Inspection report shared: {{address}}',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'Inspection Report Shared',                                                                         multiline: false },
      { key: 'body',     label: 'Body',    default: 'The inspector has shared the inspection report for {{address}} with you.',                          multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'View Report',                                                                                      multiline: false },
    ],
    variables: [
      { name: 'address',   desc: 'Property address' },
      { name: 'reportUrl', desc: 'Link to the report' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'reportUrl' },
  },

  {
    trigger: 'report-ready',
    name: 'Report ready',
    category: 'client',
    editable: true,
    required: false,
    brand: 'tenant',
    defaultSubject: 'Property Inspection Report: {{address}}',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'Report Ready',                                                                                                    multiline: false },
      { key: 'body',     label: 'Body',    default: 'The inspection for {{address}} has been completed and the report is now available.',                               multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'View Interactive Report',                                                                                         multiline: false },
    ],
    variables: [
      { name: 'address',   desc: 'Property address' },
      { name: 'reportUrl', desc: 'Link to the interactive report' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'reportUrl' },
  },

  {
    trigger: 'report-ready-pdf',
    name: 'Report ready (PDF)',
    category: 'client',
    editable: true,
    required: false,
    brand: 'tenant',
    defaultSubject: 'Property Inspection Report: {{address}}',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'Your Inspection Report',                                                                                                                                multiline: false },
      { key: 'body',     label: 'Body',    default: 'The inspection for {{address}} is complete. The full report is attached as a PDF and also available online.',                                           multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'View Interactive Report',                                                                                                                               multiline: false },
    ],
    variables: [
      { name: 'address',   desc: 'Property address' },
      { name: 'reportUrl', desc: 'Link to the interactive report' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'reportUrl' },
    systemBlocks: ['attachmentManifest'],
  },

  {
    trigger: 'agreement-request',
    name: 'Agreement signing request',
    category: 'client',
    editable: true,
    required: false,
    brand: 'tenant',
    defaultSubject: 'Please sign: {{agreementName}}',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'Document Ready to Sign',                                                                                                                          multiline: false },
      { key: 'body',     label: 'Body',    default: 'Hi {{clientName}}, you have been asked to review and sign the following agreement: {{agreementName}}.',                                           multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'Review & Sign Agreement',                                                                                                                        multiline: false },
    ],
    variables: [
      { name: 'clientName',    desc: 'Client name' },
      { name: 'agreementName', desc: 'Name of the agreement to sign' },
      { name: 'signUrl',       desc: 'Link to review and sign the agreement' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'signUrl' },
  },

  {
    trigger: 'payment-request',
    name: 'Payment request',
    category: 'client',
    editable: true,
    required: false,
    brand: 'tenant',
    defaultSubject: 'Payment request: {{amount}}',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'Payment Request',                                                                                multiline: false },
      { key: 'body',     label: 'Body',    default: 'Hi {{clientName}}, your invoice is ready. The amount due is {{amount}}.',                          multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'View & Pay Invoice',                                                                              multiline: false },
    ],
    variables: [
      { name: 'clientName', desc: 'Client name' },
      { name: 'amount',     desc: 'Amount due (formatted, e.g. $500.00)' },
      { name: 'payUrl',     desc: 'Link to the public invoice payment page' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'payUrl' },
  },

  {
    trigger: 'message-notification',
    name: 'New message',
    category: 'client',
    editable: true,
    required: false,
    brand: 'tenant',
    defaultSubject: 'New message — {{propertyAddress}}',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'New message',                                                                                                                              multiline: false },
      { key: 'body',     label: 'Body',    default: 'New message from {{fromName}} regarding {{propertyAddress}}: {{snippet}}',                                                                 multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'View conversation',                                                                                                                        multiline: false },
    ],
    variables: [
      { name: 'fromName',        desc: 'Sender name' },
      { name: 'propertyAddress', desc: 'Property address' },
      { name: 'snippet',         desc: 'Short preview of the message' },
      { name: 'viewUrl',         desc: 'Link to the conversation' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'viewUrl' },
  },

  {
    trigger: 'agreement-signed',
    name: 'Agreement signed',
    category: 'client',
    editable: true,
    required: true,
    brand: 'tenant',
    defaultSubject: 'Agreement signed — {{propertyAddress}}',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'Agreement signed',                                                                                                                                    multiline: false },
      { key: 'body',     label: 'Body',    default: 'Thank you, {{clientName}}. Your inspection agreement for {{propertyAddress}} is signed and on file.',                                                  multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'View signed agreement',                                                                                                                               multiline: false },
    ],
    variables: [
      { name: 'clientName',      desc: 'Signer name' },
      { name: 'propertyAddress', desc: 'Property address' },
      { name: 'verifyUrl',       desc: 'Public verification URL' },
      { name: 'confirmationId',  desc: 'Short confirmation code' },
      { name: 'signedAtUtc',     desc: 'ISO timestamp of the signature' },
      { name: 'ipAddress',       desc: 'IP address recorded with the signature' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'verifyUrl' },
    systemBlocks: ['auditMetadata'],
  },

  {
    trigger: 'booking-confirmation',
    name: 'Booking confirmation',
    category: 'client',
    editable: true,
    required: false,
    brand: 'tenant',
    defaultSubject: 'Inspection Scheduled: {{address}}',
    blocks: [
      { key: 'heading', label: 'Heading', default: 'Inspection Scheduled',                                                                                                                                                multiline: false },
      { key: 'body',    label: 'Body',    default: 'Hi {{clientName}}, your property inspection at {{address}} has been scheduled for {{date}} at {{time}}.',                                                              multiline: true  },
    ],
    variables: [
      { name: 'clientName', desc: 'Client name' },
      { name: 'address',    desc: 'Property address' },
      { name: 'date',       desc: 'Inspection date' },
      { name: 'time',       desc: 'Inspection time' },
    ],
    systemBlocks: ['icsHint'],
  },

  // ─── agent notifications ───────────────────────────────────────────────────
  {
    trigger: 'agent-new-referral',
    name: 'New referral booked',
    category: 'agent',
    editable: true,
    required: false,
    brand: 'tenant',
    defaultSubject: 'New referral booked: {{propertyAddress}}',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'New referral booked',                                                                                                                                      multiline: false },
      { key: 'body',     label: 'Body',    default: 'Hi {{agentName}}, an inspection at {{propertyAddress}} for {{clientName}} has been booked under your referral.',                                            multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'Open dashboard',                                                                                                                                          multiline: false },
    ],
    variables: [
      { name: 'agentName',       desc: 'Agent name' },
      { name: 'propertyAddress', desc: 'Property address' },
      { name: 'clientName',      desc: 'Client name' },
      { name: 'dashboardUrl',    desc: 'Link to the agent dashboard' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'dashboardUrl' },
  },

  {
    trigger: 'agent-report-ready',
    name: 'Agent report ready',
    category: 'agent',
    editable: true,
    required: false,
    brand: 'tenant',
    defaultSubject: 'Report ready: {{propertyAddress}}',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'Report ready to read',                                                                                            multiline: false },
      { key: 'body',     label: 'Body',    default: 'Hi {{agentName}}, the inspection report for {{propertyAddress}} has been published.',                              multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'View report',                                                                                                     multiline: false },
    ],
    variables: [
      { name: 'agentName',       desc: 'Agent name' },
      { name: 'propertyAddress', desc: 'Property address' },
      { name: 'reportUrl',       desc: 'Link to the report' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'reportUrl' },
  },

  {
    trigger: 'agent-invoice-paid',
    name: 'Agent invoice paid',
    category: 'agent',
    editable: true,
    required: false,
    brand: 'tenant',
    defaultSubject: 'Invoice paid: {{propertyAddress}}',
    blocks: [
      { key: 'heading', label: 'Heading', default: 'Invoice paid',                                                                                                                             multiline: false },
      { key: 'body',    label: 'Body',    default: 'Hi {{agentName}}, the invoice for the inspection at {{propertyAddress}} has been paid in full ({{amount}}).',                              multiline: true  },
    ],
    variables: [
      { name: 'agentName',       desc: 'Agent name' },
      { name: 'propertyAddress', desc: 'Property address' },
      { name: 'amount',          desc: 'Amount paid (formatted)' },
    ],
  },

  // ─── concierge ────────────────────────────────────────────────────────────
  {
    trigger: 'concierge-client-confirm',
    name: 'Concierge client confirm',
    category: 'concierge',
    editable: true,
    required: false,
    brand: 'tenant',
    defaultSubject: 'Confirm your home inspection at {{propertyAddress}}',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'Confirm your inspection',                                                                                                                              multiline: false },
      { key: 'body',     label: 'Body',    default: '{{inspectorName}} has scheduled an inspection for {{propertyAddress}} on {{date}}. Click below to review and confirm.',                                 multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'Review and Confirm',                                                                                                                                   multiline: false },
    ],
    variables: [
      { name: 'inspectorName',   desc: 'Inspector name' },
      { name: 'propertyAddress', desc: 'Property address' },
      { name: 'date',            desc: 'Scheduled inspection date' },
      { name: 'confirmUrl',      desc: 'Confirmation link' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'confirmUrl' },
  },

  {
    trigger: 'concierge-inspector-review',
    name: 'Concierge inspector review',
    category: 'concierge',
    editable: true,
    required: false,
    brand: 'tenant',
    defaultSubject: 'Concierge booking awaiting your review: {{propertyAddress}}',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'A booking needs your review',                                                                                                                              multiline: false },
      { key: 'body',     label: 'Body',    default: 'A partner agent submitted an inspection booking for {{clientName}} at {{propertyAddress}} on {{date}}.',                                                    multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'Open Dashboard',                                                                                                                                          multiline: false },
    ],
    variables: [
      { name: 'clientName',      desc: 'Client name' },
      { name: 'propertyAddress', desc: 'Property address' },
      { name: 'date',            desc: 'Scheduled inspection date' },
      { name: 'reviewUrl',       desc: 'Link to review the booking' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'reviewUrl' },
  },

  {
    trigger: 'concierge-confirmed-agent',
    name: 'Concierge confirmed (agent)',
    category: 'concierge',
    editable: true,
    required: false,
    brand: 'tenant',
    defaultSubject: 'Concierge booking confirmed: {{propertyAddress}}',
    blocks: [
      { key: 'heading', label: 'Heading', default: 'Your client confirmed',                                                                                        multiline: false },
      { key: 'body',    label: 'Body',    default: '{{clientName}} has confirmed the inspection for {{propertyAddress}} on {{date}}.',                              multiline: true  },
    ],
    variables: [
      { name: 'clientName',      desc: 'Client name' },
      { name: 'propertyAddress', desc: 'Property address' },
      { name: 'date',            desc: 'Scheduled inspection date' },
    ],
  },

  {
    trigger: 'concierge-cancelled-agent',
    name: 'Concierge cancelled (agent)',
    category: 'concierge',
    editable: true,
    required: false,
    brand: 'tenant',
    defaultSubject: 'Concierge booking cancelled: {{propertyAddress}}',
    blocks: [
      { key: 'heading', label: 'Heading', default: 'A booking was cancelled',                                                                                                          multiline: false },
      { key: 'body',    label: 'Body',    default: 'The inspector cancelled the inspection scheduled for {{propertyAddress}} on {{date}}. {{reason}}',                                 multiline: true  },
    ],
    variables: [
      { name: 'propertyAddress', desc: 'Property address' },
      { name: 'date',            desc: 'Scheduled inspection date' },
      { name: 'reason',          desc: 'Cancellation reason' },
    ],
  },

  // ─── evidence / compliance ─────────────────────────────────────────────────
  {
    trigger: 'evidence-pack',
    name: 'Evidence pack',
    category: 'client',
    editable: true,
    required: true,
    brand: 'tenant',
    defaultSubject: 'Your signed agreement',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'Your signed agreement',                                                                                                                                            multiline: false },
      { key: 'body',     label: 'Body',    default: 'Hi {{clientName}}, your signed agreement and full evidence pack are attached to this email for your records.',                                                      multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'Verify signed agreement',                                                                                                                                          multiline: false },
    ],
    variables: [
      { name: 'clientName',  desc: 'Client name' },
      { name: 'envelopeId',  desc: 'Agreement envelope ID' },
      { name: 'verifyUrl',   desc: 'Public verification URL' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'verifyUrl' },
    systemBlocks: ['attachmentManifest'],
  },
];

const BY_TRIGGER = new Map(REGISTRY.map(d => [d.trigger, d]));

export function getDescriptor(trigger: string): EmailTemplateDescriptor | undefined {
  return BY_TRIGGER.get(trigger);
}
