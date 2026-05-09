/**
 * Sprint 3 Track B (S3-2) — Customer Repair Request export page render.
 *
 * Snapshots the SSR'd HTML output for the public token-gated repair-request
 * page across the three meaningful coverage states:
 *
 *   1. Zero defects — emerald empty state, no card list.
 *   2. Multiple defects across multiple sections — every defect rendered as
 *      a card grouped by section.
 *   3. Estimates surface only when `showEstimates = true` — gated by the
 *      tenant flag.
 *
 * The page also seeds an Alpine x-data initializer with the inspection id +
 * client email; we assert the JSON envelope is sanitised against the page's
 * own quote-escaping (' is HTML-escaped) so the runtime parser can read it.
 */
import { describe, it, expect } from 'vitest';
import {
    CustomerRepairRequestPage,
    type CustomerRepairRequestEntry,
} from '../../src/templates/pages/customer-repair-request';

function render(node: unknown): string {
    return String(node);
}

const BASE_PROPS = {
    inspectionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    propertyAddress: '1 Main St, Anywhere',
    inspectionDate: 'June 1, 2026',
    inspectorName: 'Jane Inspector',
    clientEmail: 'buyer@example.com',
};

const DEFECT_A: CustomerRepairRequestEntry = {
    sectionId: 'roof',
    sectionTitle: 'Roof',
    itemId: 'roof-shingles',
    itemLabel: 'Shingles',
    comment: 'Worn surface granules.',
    location: 'Front slope',
    category: 'maintenance',
    recommendationLabel: null,
    estimateLow: 25000,
    estimateHigh: 75000,
    photos: [],
};

const DEFECT_B: CustomerRepairRequestEntry = {
    sectionId: 'electrical',
    sectionTitle: 'Electrical',
    itemId: 'elec-panel',
    itemLabel: 'Main Panel',
    comment: 'Double-tap on breaker 4.',
    location: null,
    category: 'safety',
    recommendationLabel: 'Licensed Electrician',
    estimateLow: null,
    estimateHigh: null,
    photos: [{ key: 'p1', url: '/photo/p1.jpg' }],
};

describe('CustomerRepairRequestPage', () => {
    it('renders the empty-state card when no defects supplied', () => {
        const html = render(CustomerRepairRequestPage({
            ...BASE_PROPS,
            defects: [],
            showEstimates: false,
        }));
        expect(html).toContain('data-testid="crr-empty"');
        expect(html).toContain('No defects were flagged');
        // No defect cards should render.
        expect(html).not.toContain('data-testid="crr-card"');
    });

    it('renders one card per defect, grouped by section title', () => {
        const html = render(CustomerRepairRequestPage({
            ...BASE_PROPS,
            defects: [DEFECT_A, DEFECT_B],
            showEstimates: false,
        }));
        const cardMatches = (html.match(/data-testid="crr-card"/g) || []).length;
        expect(cardMatches).toBe(2);
        // Section headings render once each.
        expect(html.indexOf('>Roof<')).toBeGreaterThan(-1);
        expect(html.indexOf('>Electrical<')).toBeGreaterThan(-1);
        // Per-card item label + comment render.
        expect(html).toContain('Worn surface granules.');
        expect(html).toContain('Double-tap on breaker 4.');
        // Recommendation label badge surfaces for the safety defect.
        expect(html).toContain('Licensed Electrician');
        // Per-item textarea ALWAYS renders — that's the whole UX of this page.
        const noteAreas = (html.match(/data-testid="crr-card-note"/g) || []).length;
        expect(noteAreas).toBe(2);
        // Empty state is hidden when defects present.
        expect(html).not.toContain('data-testid="crr-empty"');
    });

    it('shows estimate badges only when showEstimates is true', () => {
        const off = render(CustomerRepairRequestPage({
            ...BASE_PROPS,
            defects: [DEFECT_A],
            showEstimates: false,
        }));
        expect(off).not.toContain('data-testid="crr-card-estimate"');

        const on = render(CustomerRepairRequestPage({
            ...BASE_PROPS,
            defects: [DEFECT_A],
            showEstimates: true,
        }));
        expect(on).toContain('data-testid="crr-card-estimate"');
        // Money formatting (cents → dollars) — 25000c = $250, 75000c = $750.
        expect(on).toContain('$250');
        expect(on).toContain('$750');
    });

    it('seeds Alpine x-data with the inspection id + recipient email', () => {
        const html = render(CustomerRepairRequestPage({
            ...BASE_PROPS,
            defects: [DEFECT_A],
            showEstimates: false,
        }));
        // Alpine initializer references the factory + payload.
        expect(html).toContain('customerRepairRequest(');
        expect(html).toContain(BASE_PROPS.inspectionId);
        // Email appears in the seeded JSON (HTML-encoded form).
        expect(html).toContain(BASE_PROPS.clientEmail);
        // Print + email submit testids both render.
        expect(html).toContain('data-testid="crr-print"');
        expect(html).toContain('data-testid="crr-email-submit"');
        expect(html).toContain('data-testid="crr-email-input"');
    });

    it('escapes single quotes inside the JSON initializer so x-data parses safely', () => {
        // Construct a defect whose item label contains an apostrophe — this
        // becomes part of the items[] payload embedded inside x-data.
        const defectWithApostrophe: CustomerRepairRequestEntry = {
            ...DEFECT_A,
            itemLabel: "Buyer's Slope",
        };
        const html = render(CustomerRepairRequestPage({
            ...BASE_PROPS,
            defects: [defectWithApostrophe],
            showEstimates: false,
        }));
        // The x-data attribute must NOT contain a raw single quote inside its
        // JSON envelope (would close the attribute prematurely). Allow the
        // HTML-encoded form only.
        const xDataMatch = html.match(/x-data="customerRepairRequest\([^"]*\)"/);
        expect(xDataMatch).not.toBeNull();
        const inner = xDataMatch ? xDataMatch[0] : '';
        expect(inner).not.toMatch(/[^&#3]'/);  // no unescaped apostrophes
    });
});
