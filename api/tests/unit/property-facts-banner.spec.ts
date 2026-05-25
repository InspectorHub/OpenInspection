/**
 * Round-2 backlog G1 (Spectora §E.2) — PropertyFactsBanner render coverage.
 *
 * Asserts:
 *   - Renders nothing when every fact is null/empty.
 *   - Renders a card with each populated cell + label/value pair.
 *   - SqFt is comma-formatted (1,800).
 *   - Bathrooms formatted with at most one decimal; integer baths stay
 *     decimal-free.
 *   - Foundation enum maps to a friendly label.
 */

import { describe, it, expect } from 'vitest';
import { PropertyFactsBanner } from '../../src/templates/components/property-facts-card';

function render(node: unknown): string {
    if (node === null || node === undefined) return '';
    return String(node);
}

const EMPTY = {
    yearBuilt:      null,
    sqft:           null,
    foundationType: null,
    lotSize:        null,
    bedrooms:       null,
    bathrooms:      null,
};

describe('PropertyFactsBanner', () => {
    it('renders null when every fact is empty', () => {
        const out = PropertyFactsBanner({ facts: EMPTY });
        expect(out).toBeNull();
    });

    it('renders a banner with populated cells only', () => {
        const html = render(PropertyFactsBanner({ facts: {
            yearBuilt: 1990, sqft: 1800, foundationType: 'basement',
            lotSize: '0.25 acres', bedrooms: 3, bathrooms: 2.5,
        }}));
        expect(html).toContain('report-property-facts-banner');
        expect(html).toContain('Year Built');
        expect(html).toContain('1990');
        expect(html).toContain('Sq Ft');
        expect(html).toContain('1,800'); // comma-formatted
        expect(html).toContain('Foundation');
        expect(html).toContain('Basement'); // friendly label
        expect(html).toContain('Lot Size');
        expect(html).toContain('0.25 acres');
        expect(html).toContain('Bedrooms');
        expect(html).toContain('Bathrooms');
        expect(html).toContain('2.5');
    });

    it('omits cells whose value is null or empty', () => {
        const html = render(PropertyFactsBanner({ facts: {
            ...EMPTY,
            yearBuilt: 2010,
        }}));
        expect(html).toContain('Year Built');
        expect(html).toContain('2010');
        // Other labels must NOT be present.
        expect(html).not.toContain('Sq Ft');
        expect(html).not.toContain('Foundation');
        expect(html).not.toContain('Bedrooms');
    });

    it('renders integer bathrooms without decimals', () => {
        const html = render(PropertyFactsBanner({ facts: {
            ...EMPTY,
            bathrooms: 3,
        }}));
        expect(html).toContain('Bathrooms');
        // Must NOT render "3.0"
        expect(html).not.toMatch(/3\.0/);
    });

    it('treats whitespace-only lotSize as empty', () => {
        const html = render(PropertyFactsBanner({ facts: {
            ...EMPTY,
            lotSize: '   ',
        }}));
        // banner suppressed entirely because no other fact set
        expect(html).toBe('');
    });
});
