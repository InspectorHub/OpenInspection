import type { EmailTemplateDescriptor } from '../types';

/**
 * Account recovery, workspace invitations, and our own billing notices —
 * the messages that are OURS rather than a tenant's.
 *
 * One slice of the template catalog; `registry.ts` composes the four.
 */
export const SYSTEM_TEMPLATES: EmailTemplateDescriptor[] = [
  {
    trigger: 'password-reset',
    name: 'Password reset',
    category: 'system',
    editable: false,
    required: true,
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
    required: true,
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

  // The two free-tier quota notices. `editable: false` + `brand: 'platform'`
  // because these are OUR message to the workspace owner about OUR billing —
  // the same footing as `password-reset`, not a tenant's customer-facing mail.
  // They are two templates rather than one with a variable because they say
  // different things: one is a heads-up, the other is a wall.
  // SaaS-only (standalone has no quota); a self-hosted deployment lists them
  // and never sends them — see spec §2.6b, which V4 resolves.
  {
    trigger: 'usage-quota-warning',
    name: 'Free inspections running out',
    category: 'system',
    editable: false,
    required: true,
    brand: 'platform',
    defaultSubject: 'One free inspection left',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'One free inspection left',                                                                          multiline: false },
      { key: 'body',     label: 'Body',    default: 'Your {{workspaceName}} workspace has used 4 of your 5 free inspections. You have one free inspection left.', multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'Manage subscription',                                                                               multiline: false },
    ],
    variables: [
      { name: 'workspaceName',    desc: 'Workspace / company name' },
      { name: 'billingPortalUrl', desc: 'Link to the billing portal' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'billingPortalUrl' },
  },

  {
    trigger: 'usage-quota-reached',
    name: 'Free inspections used up',
    category: 'system',
    editable: false,
    required: true,
    brand: 'platform',
    defaultSubject: "You've used your 5 free inspections",
    blocks: [
      { key: 'heading',  label: 'Heading', default: "You've used your 5 free inspections",                                                                             multiline: false },
      { key: 'body',     label: 'Body',    default: 'Your {{workspaceName}} workspace has used all 5 free inspections. Everything you already have stays usable — subscribe to create new ones.', multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'Manage subscription',                                                                                             multiline: false },
    ],
    variables: [
      { name: 'workspaceName',    desc: 'Workspace / company name' },
      { name: 'billingPortalUrl', desc: 'Link to the billing portal' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'billingPortalUrl' },
  },

  // A workspace deletion that did not finish.
  //
  // `editable: false` for a stronger reason than the quota notices: this is a
  // compliance statement the deployment is making, and a tenant able to rewrite it
  // could soften or contradict the fact being reported. `brand: 'platform'`
  // because by the time it sends the workspace's own branding has been
  // destroyed along with everything else.
  //
  // No CTA. There is nothing for the recipient to click — the remediation is
  // ours — and a button would imply an action they can take.
  //
  // The wording is mechanical. A deletion that did not finish is not a security
  // incident, and a template that read like one would misinform the recipient
  // about what happened and what it asks of them.
  {
    trigger: 'destruction-incomplete',
    name: 'Workspace deletion did not finish',
    category: 'system',
    editable: false,
    required: true,
    brand: 'platform',
    defaultSubject: 'Workspace deletion did not complete',
    blocks: [
      { key: 'heading', label: 'Heading', default: 'Workspace deletion did not complete', multiline: false },
      { key: 'body',    label: 'Body',    default: '{{noticeBody}}',                      multiline: true  },
    ],
    variables: [
      { name: 'noticeBody', desc: 'The statement of which stores did not complete, built by the purge' },
    ],
  },

  // The four messages an import run sends.
  //
  // `brand: 'tenant'` and `editable: true`: the recipient is the workspace's
  // own owner reading about their own workspace, so it should look like their
  // product — and unlike the quota notices there is no statement about OUR
  // billing here that a tenant could soften into something untrue.
  {
    trigger: 'migration-import-received',
    name: 'Import received',
    category: 'system',
    editable: true,
    required: true,
    brand: 'tenant',
    defaultSubject: 'We have your import file',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'We have your file',                                                                                   multiline: false },
      { key: 'body',     label: 'Body',    default: 'Somebody is looking at the file you uploaded. We will come back to you within ten working days, either with it converted and ready for you to review, or with an explanation of why it could not be.', multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'View this import',                                                                                    multiline: false },
    ],
    variables: [{ name: 'importLink', desc: 'Link to this import run' }],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'importLink' },
  },

  {
    trigger: 'migration-import-ready',
    name: 'Import ready to review',
    category: 'system',
    editable: true,
    required: true,
    brand: 'tenant',
    defaultSubject: 'Your import is ready to review',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'Your import is ready to review',                                                                      multiline: false },
      { key: 'body',     label: 'Body',    default: 'We have converted the file you sent. Nothing has been added to your workspace yet — open the import to see exactly what it will add, correct anything that needs it, and apply it when you are happy.', multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'Review this import',                                                                                  multiline: false },
    ],
    variables: [{ name: 'importLink', desc: 'Link to this import run' }],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'importLink' },
  },

  // No CTA on the refusal. The import is over; a button would imply there is
  // something to do on that screen, and the next step is a different export or
  // a conversation.
  {
    trigger: 'migration-import-declined',
    name: 'Import could not be converted',
    category: 'system',
    editable: true,
    required: true,
    brand: 'tenant',
    defaultSubject: 'We could not convert your import file',
    blocks: [
      { key: 'heading',  label: 'Heading',   default: 'We could not convert your file',                                                                    multiline: false },
      { key: 'body',     label: 'Body',      default: '{{declineReason}}',                                                                                 multiline: true  },
      { key: 'nextStep', label: 'Next step', default: 'Your file has not been kept. If you can export in another format, upload it and we will look again.', multiline: true },
    ],
    variables: [{ name: 'declineReason', desc: 'Why the file could not be converted, written by whoever looked at it' }],
  },

  {
    trigger: 'migration-import-expiring',
    name: 'Import about to be cleared',
    category: 'system',
    editable: true,
    required: true,
    brand: 'tenant',
    defaultSubject: 'An import you started is about to be cleared',
    blocks: [
      { key: 'heading',  label: 'Heading', default: 'An import you started is about to be cleared',                                                        multiline: false },
      { key: 'body',     label: 'Body',    default: 'The file you uploaded, and everything prepared from it, will be deleted on {{expiresOn}}. Finish the import before then, or start again later with a fresh upload.', multiline: true  },
      { key: 'ctaLabel', label: 'Button',  default: 'Open this import',                                                                                    multiline: false },
    ],
    variables: [
      { name: 'importLink', desc: 'Link to this import run' },
      { name: 'expiresOn',  desc: 'The date the file and its prepared entries are deleted' },
    ],
    cta: { labelBlockKey: 'ctaLabel', urlVar: 'importLink' },
  },
];
