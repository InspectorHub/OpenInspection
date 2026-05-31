import { describe, it, expect } from 'vitest';
import { auditLogs } from '../../server/lib/db/schema/tenant';

describe('auditLogs schema — Sprint B-3', () => {
    it('declares an inspector_slug TEXT column (nullable)', () => {
        // Drizzle column type lookups: the column object exposes its DB name
        // and dataType. Sprint B adds inspector_slug for cross-inspection
        // human-readable grouping; nullable so non-inspector-action events
        // (logins, settings tweaks) leave it NULL.
        const col = (auditLogs as unknown as { inspectorSlug?: { name: string; notNull?: boolean } }).inspectorSlug;
        expect(col).toBeDefined();
        expect(col?.name).toBe('inspector_slug');
        expect(col?.notNull ?? false).toBe(false);
    });
});
