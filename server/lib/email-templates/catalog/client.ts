import type { EmailTemplateDescriptor } from '../types';

/**
 * The client track — portal access, the report, money, the signed record, and
 * the two links a client can share onward.
 *
 * One slice of the template catalog; `registry.ts` composes the four.
 */
export const CLIENT_TEMPLATES: EmailTemplateDescriptor[] = [
  {
    // The client portal's magic sign-in link (`POST /api/portal/:tenant/request-link`).
    // Tenant-branded, unlike the `agent-login-link` above: an agent account is
    // global and signs in to us, while a client's portal belongs to one company.
    trigger: 'client-portal-login',
    name: 'Client portal sign-in link',
    category: 'client',
    editable: true,
    required: true,
    brand: 'tenant',
    defaultSubject: 'Sign in to your client portal',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'Sign in to your portal',                                                                     multiline: false },
      { key: 'body',     label: 'Body',    default: 'Click the button below to access your inspections. This link expires in 15 minutes.',        multiline: true  },
      { key: 'note',     label: 'Note',    default: "If you didn't request this, you can safely ignore this email.",                              multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'Open my portal',                                                                             multiline: false },
    ],
    variables: [
      { name: 'loginUrl', desc: 'One-time portal sign-in link' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'loginUrl' },
  },

  {
    // Sent when someone on the repair-request page types an address and presses
    // send — a contractor, an agent, the other side of the transaction.
    //
    // `required: true` for a reason the two words above do not obviously cover:
    // the recipient is an address typed into a box, with no account and no
    // ongoing relationship, so there is nowhere for a preference to live.
    // "Suppressible" could therefore only mean the OPERATOR switch, and that
    // turns a send button into one that reports success and does nothing.
    trigger: 'repair-request-share',
    name: 'Repair request share',
    category: 'client',
    editable: true,
    required: true,
    brand: 'tenant',
    defaultSubject: 'Repair request — {{propertyAddress}}',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'Repair request',                                                                                        multiline: false },
      { key: 'body',     label: 'Body',    default: 'A repair request list for {{propertyAddress}} has been shared with you. Open the link below to review the items.', multiline: true  },
      // Renders nothing when the sender wrote no note — the layout drops blocks
      // that resolve to empty rather than leaving a blank paragraph behind.
      { key: 'message',  label: 'Sender message', default: '{{message}}',                                                                                    multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'View repair request',                                                                                   multiline: false },
    ],
    variables: [
      { name: 'propertyAddress', desc: 'Property address' },
      { name: 'message',         desc: "The sender's optional note" },
      { name: 'shareUrl',        desc: 'Link to the shared repair request' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'shareUrl' },
  },

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
    required: true,
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
    required: true,
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
    required: true,
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
    required: true,
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
