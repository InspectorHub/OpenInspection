import type { EmailTemplateDescriptor } from '../types';

/**
 * The concierge booking flow: the agent books, the client confirms.
 *
 * One slice of the template catalog; `registry.ts` composes the four.
 */
export const CONCIERGE_TEMPLATES: EmailTemplateDescriptor[] = [
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
];
