/**
 * Our report-link fields against ISN's own description of the endpoint
 * (vendor/addreporturl.openapi.json — provenance in vendor/SOURCES.md).
 *
 * Two questions, answered offline:
 *   1. Does every field we send exist on the operation, with a value its type
 *      admits? A misspelt field is ignored by ISN with a 200, so nothing else
 *      would notice.
 *   2. Does the document still claim a form-encoded body? We deliberately send
 *      the query string instead (see isn-api.live.spec.ts). If ISN corrects the
 *      document, this fails, and the deviation should be re-examined.
 */
import { describe, expect, it } from 'vitest';
import spec from './vendor/addreporturl.openapi.json';
import { buildReportLinkParams } from '../../../server/services/isn/report-link-payload';

type Prop = { type: string | string[] };
const op = spec.paths['/orders/addreporturl'].put;
const props = op.requestBody.content['application/x-www-form-urlencoded'].schema.properties as Record<string, Prop>;

function admits(prop: Prop, value: string): boolean {
    const types = Array.isArray(prop.type) ? prop.type : [prop.type];
    if (types.includes('string')) return true;
    // A form or query value is text; a boolean arrives as "true"/"false".
    return types.includes('boolean') && (value === 'true' || value === 'false');
}

describe('addreporturl payload vs ISN schema', () => {
    const params = buildReportLinkParams({ orderId: '11111111-2222-4333-8444-555555555555', url: 'https://x.test/r', title: 'Inspection Report' });

    it('sends only fields the operation declares, each with a value its type admits', () => {
        expect(Object.keys(params).length).toBeGreaterThan(0); // positive control
        for (const [field, value] of Object.entries(params)) {
            expect(props, `ISN declares no "${field}"`).toHaveProperty(field);
            expect(admits(props[field]!, value), `"${field}" = ${value}`).toBe(true);
        }
    });

    it('marks the link public, which is what puts it on the client delivery page', () => {
        expect(params.public).toBe('true');
    });

    it('still documents a form-encoded body that ISN ignores (we send the query string)', () => {
        expect(Object.keys(op.requestBody.content)).toEqual(['application/x-www-form-urlencoded']);
    });
});
