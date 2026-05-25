import { describe, it, expect } from 'vitest';
import { ICON_PATHS, Icon } from '../../src/lib/icons';

describe('ICON_PATHS', () => {
    it('has at least 27 entries', () => {
        expect(Object.keys(ICON_PATHS).length).toBeGreaterThanOrEqual(27);
    });

    it('includes all design spec icons', () => {
        const expected = [
            'dashboard', 'calendar', 'contacts', 'check', 'message', 'store',
            'bell', 'search', 'arrowR', 'chevR', 'chevL', 'chevD', 'plus', 'x',
            'edit', 'share', 'mail', 'camera', 'mic', 'print', 'back', 'moon',
            'sun', 'filter', 'panel', 'card', 'zap', 'clock', 'panelRC', 'panelRO',
        ];
        for (const name of expected) {
            expect(ICON_PATHS, `missing icon: ${name}`).toHaveProperty(name);
        }
    });

    it('every path is a non-empty string', () => {
        for (const [name, path] of Object.entries(ICON_PATHS)) {
            expect(typeof path, `${name} should be string`).toBe('string');
            expect(path.length, `${name} should be non-empty`).toBeGreaterThan(0);
        }
    });
});

describe('Icon component', () => {
    it('returns null for unknown icon name', () => {
        expect(Icon({ name: 'nonexistent' })).toBeNull();
    });

    it('returns non-null for known icon', () => {
        const result = Icon({ name: 'check', size: 20 });
        expect(result).not.toBeNull();
    });
});
