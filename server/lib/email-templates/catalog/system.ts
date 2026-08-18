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
  // compliance statement made under review, and a tenant able to rewrite it
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
];
