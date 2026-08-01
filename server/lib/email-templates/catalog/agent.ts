import type { EmailTemplateDescriptor } from '../types';

/**
 * Everything addressed to a partner agent: getting into their account, and
 * the three referral notifications they already control per-agent.
 *
 * One slice of the template catalog; `registry.ts` composes the four.
 */
export const AGENT_TEMPLATES: EmailTemplateDescriptor[] = [
  {
    trigger: 'agent-invite',
    name: 'Partner agent invite',
    category: 'agent',
    editable: true,
    required: true,
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
    required: true,
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
];
