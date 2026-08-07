/**
 * The suggest-comment request must not carry a property address.
 *
 * `SuggestCommentSchema` accepted `propertyAddress` and the prompt never
 * referenced it, so the address was validated, dropped on the floor, and never
 * sent to Google. That is a good outcome held in place by nothing: the only
 * thing recording it was a sentence in a comment above the prompt's args
 * interface. Rewording the prompt to "use the property context" would have
 * started shipping client addresses to a third-party model with no change to
 * the route, no change to the schema, and nothing to review.
 *
 * The field is gone rather than guarded (option (a)): a field that does not
 * exist cannot be referenced by a future prompt edit. These cases are what
 * keeps it gone — re-adding it to the schema, or naming an address in the
 * prompt module, turns them red.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SuggestCommentSchema } from '../../../server/lib/validations/ai.schema';
import { AI_PROMPTS, type SuggestCommentPromptArgs } from '../../../server/lib/ai/prompts';

const promptsPath = path.resolve(__dirname, '../../../server/lib/ai/prompts.ts');

/** Source with comments stripped: prose must not satisfy or trip the scan. */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('the AI suggest request has no address field', () => {
    it('SuggestCommentSchema declares no address-shaped key', () => {
        const keys = Object.keys(SuggestCommentSchema.shape);
        expect(keys).not.toContain('propertyAddress');
        expect(keys.filter((k) => /address|street|zip|city/i.test(k))).toEqual([]);
    });

    it('an address sent by a caller is dropped at the boundary, not carried inward', () => {
        // The API is reachable by MCP clients and by anything else holding a
        // token. Removing the field from the schema is what makes a caller that
        // still sends one unable to hand it to the prompt.
        const parsed = SuggestCommentSchema.parse({
            itemName: 'Roof Covering',
            sectionName: 'Roof',
            propertyAddress: '123 Oak St, Springfield',
        });
        expect(parsed).not.toHaveProperty('propertyAddress');
        expect(JSON.stringify(parsed)).not.toContain('Oak St');
    });

    it('the rendered prompt contains no address even when one is forced in', () => {
        // The assertion that actually protects the client: whatever a caller
        // manages to attach, the text sent to the model does not name it.
        const rogue = {
            itemName: 'Roof Covering',
            sectionName: 'Roof',
            propertyAddress: '123 Oak St, Springfield',
        } as unknown as SuggestCommentPromptArgs;
        const rendered = AI_PROMPTS.suggestComment.render(rogue);
        expect(rendered).not.toContain('Oak St');
        expect(rendered).not.toContain('123');
    });

    it('no prompt in the module references an address at all', () => {
        // The machine-checkable half of the rule the old comment stated in
        // prose. A prompt edit that starts interpolating an address family
        // field fails here instead of shipping.
        const code = stripComments(fs.readFileSync(promptsPath, 'utf8'));
        expect(code).not.toMatch(/address/i);
    });
});
