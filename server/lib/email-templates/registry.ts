import type { EmailTemplateDescriptor } from './types';
import { SYSTEM_TEMPLATES } from './catalog/system';
import { CLIENT_TEMPLATES } from './catalog/client';
import { AGENT_TEMPLATES } from './catalog/agent';
import { CONCIERGE_TEMPLATES } from './catalog/concierge';

/**
 * Every email template the code can send, and the copy it sends.
 *
 * Split by audience into `catalog/` — as one array it outgrew the file-size
 * gate, and the four groups are how anyone reasons about it anyway. Order here
 * is the order the admin template list shows.
 *
 * This is the COPY store. The list of what we send, and whether each may be
 * switched off, lives in `../notifications/classes.ts`; a template with no
 * class fails the build.
 */
export const REGISTRY: EmailTemplateDescriptor[] = [
  ...SYSTEM_TEMPLATES,
  ...AGENT_TEMPLATES,
  ...CLIENT_TEMPLATES,
  ...CONCIERGE_TEMPLATES,
];

const BY_TRIGGER = new Map(REGISTRY.map(d => [d.trigger, d]));

export function getDescriptor(trigger: string): EmailTemplateDescriptor | undefined {
  return BY_TRIGGER.get(trigger);
}
