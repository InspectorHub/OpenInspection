import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpProps } from '../../durable-objects/inspector-mcp';

/**
 * MCP Prompts (Phase E): a curated set of argument-bearing prompt templates an
 * MCP client can offer the user (e.g. "Summarize inspection …"). Prompts carry
 * NO data themselves — they emit a single user message that instructs the model
 * to use the granted tools/resources. Each prompt is gated by the scopes its
 * workflow needs, so a client only sees prompts it can actually fulfil.
 */

export interface PromptDef {
    name: string;
    description: string;
    /** Zod raw shape for the prompt arguments (all string-valued). */
    argsSchema: Record<string, z.ZodType>;
    /** Granted scopes (kind:tag) ALL required for this prompt to be offered. */
    requires: string[];
    /** Build the user-message text from the supplied arguments. */
    build: (args: Record<string, string>) => string;
}

export const PROMPTS: PromptDef[] = [
    {
        name: 'summarize_inspection',
        description: 'Summarize an inspection — property, key findings, and overall condition.',
        argsSchema: { inspection_id: z.string().describe('The id of the inspection to summarize') },
        requires: ['read:inspections'],
        build: ({ inspection_id }) =>
            `Summarize OpenInspection inspection \`${inspection_id}\`.\n\n` +
            `Fetch it with the \`openinspection_get_inspection\` tool (or read the ` +
            `\`openinspection:///api/inspections/${inspection_id}\` resource), then write a concise ` +
            `summary covering: the property and client, the inspection status, the most significant ` +
            `defects grouped by severity, and an overall condition assessment. Be factual and cite ` +
            `finding locations.`,
    },
    {
        name: 'draft_repair_request',
        description: "Draft a prioritized repair request from an inspection's findings.",
        argsSchema: { inspection_id: z.string().describe('The id of the inspection') },
        requires: ['read:inspections'],
        build: ({ inspection_id }) =>
            `Draft a repair request for inspection \`${inspection_id}\`.\n\n` +
            `Fetch the inspection's findings, then produce a prioritized list of repair items a client ` +
            `could send to the seller's agent. For each item give a clear title, the affected ` +
            `system/location, why it matters, and a suggested action. Group by priority ` +
            `(safety, major, minor). Keep it professional and neutral.`,
    },
    {
        name: 'review_findings',
        description: 'Review an inspection\'s findings for gaps, unclear wording, or missing photos.',
        argsSchema: { inspection_id: z.string().describe('The id of the inspection') },
        requires: ['read:inspections'],
        build: ({ inspection_id }) =>
            `Review the findings of inspection \`${inspection_id}\` for quality.\n\n` +
            `Fetch the inspection, then flag: findings with vague or ambiguous wording, defects missing ` +
            `a recommended action, items that likely need a photo, and inconsistent severity ratings. ` +
            `Return concrete, itemized suggestions.`,
    },
    {
        name: 'client_follow_up_email',
        description: 'Draft a follow-up email to a client contact.',
        argsSchema: {
            contact_id: z.string().describe('The id of the client contact'),
            topic: z.string().describe('What the follow-up is about'),
        },
        requires: ['read:contacts'],
        build: ({ contact_id, topic }) =>
            `Draft a follow-up email to contact \`${contact_id}\` about: ${topic}.\n\n` +
            `Fetch the contact's details first, then write a warm, professional email addressed to them ` +
            `by name. Keep it brief, include a clear next step, and sign off as the inspection company.`,
    },
];

/** The prompts whose required scopes are all present in the grant. */
export function selectPrompts(grantedScopes: string[]): PromptDef[] {
    const granted = new Set(grantedScopes);
    const has = (s: string) => {
        const kind = s.split(':')[0];
        return granted.has(s) || granted.has(`${kind}:*`);
    };
    return PROMPTS.filter((p) => p.requires.every(has));
}

/** Register the granted prompts on `server`. Synchronous — prompts make no API
 * calls; they only emit a guiding user message. */
export function registerGrantedPrompts(server: McpServer, props: McpProps): void {
    for (const p of selectPrompts(props.scopes)) {
        server.registerPrompt(
            p.name,
            { description: p.description, argsSchema: p.argsSchema },
            (args) => ({
                messages: [
                    {
                        role: 'user' as const,
                        content: { type: 'text' as const, text: p.build(args as Record<string, string>) },
                    },
                ],
            }),
        );
    }
}
