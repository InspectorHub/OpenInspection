/**
 * The `@core/offline-package` package on its own: the schemas and limits a
 * device and the server both read. Every refusal is paired with a positive
 * control (the same input minus the fault is accepted).
 */
import { describe, it, expect } from 'vitest';
import {
    OfflinePackageManifestSchema, OutboxSchema, MediaIndexSchema, OFFLINE_ID_PATTERN, PACKAGE_MAX_AGE_DAYS,
    DEFAULT_IMPORT_LIMITS, IMPORT_LIMIT_CEILINGS,
} from '@core/offline-package';

const manifest = {
    format: 'openinspection-offline-package',
    version: 1,
    tenantId: 'tenant-1',
    deviceId: 'device-1',
    exportedBy: 'user-a',
    exportedAt: '2026-10-01T12:00:00.000Z',
    inspections: [{ id: 'insp-1', reportId: 'rep-1' }],
};

describe('@core/offline-package manifest', () => {
    it('accepts a valid manifest and ignores unknown keys', () => {
        expect(OfflinePackageManifestSchema.safeParse(manifest).success).toBe(true);
        expect(OfflinePackageManifestSchema.safeParse({ ...manifest, addedLater: 'x' }).success).toBe(true);
    });

    it('rejects an id that could smuggle a path separator', () => {
        expect(OFFLINE_ID_PATTERN.test('insp-1')).toBe(true);
        expect(OFFLINE_ID_PATTERN.test('../insp')).toBe(false);
        const bad = { ...manifest, inspections: [{ id: 'a/b', reportId: 'rep-1' }] };
        expect(OfflinePackageManifestSchema.safeParse(bad).success).toBe(false);
    });

    it('rejects a duplicate inspection id but accepts distinct ones', () => {
        const row = { id: 'insp-1', reportId: 'rep-1' };
        expect(OfflinePackageManifestSchema.safeParse({ ...manifest, inspections: [row, { ...row, id: 'insp-2' }] }).success).toBe(true);
        expect(OfflinePackageManifestSchema.safeParse({ ...manifest, inspections: [row, row] }).success).toBe(false);
    });
});

describe('@core/offline-package outbox and media index', () => {
    const entry = { idempotencyKey: 'key-1', op: 'inspection.update', payload: { id: 'insp-1', title: 'x' } };

    it('accepts an entry, keeping extra payload keys', () => {
        const parsed = OutboxSchema.safeParse([entry]);
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data[0]?.payload).toMatchObject({ title: 'x' });
    });

    it('rejects an extra envelope key and an unknown op', () => {
        expect(OutboxSchema.safeParse([{ ...entry, extra: 1 }]).success).toBe(false);
        expect(OutboxSchema.safeParse([{ ...entry, op: 'inspection.delete' }]).success).toBe(false);
    });

    it('accepts a media row and rejects an unsupported content type', () => {
        const row = { pendingId: 'p-1', inspectionId: 'insp-1', contentType: 'image/jpeg' };
        expect(MediaIndexSchema.safeParse([row]).success).toBe(true);
        expect(MediaIndexSchema.safeParse([{ ...row, contentType: 'image/gif' }]).success).toBe(false);
    });
});

describe('@core/offline-package constants', () => {
    it('keeps every default limit within its ceiling', () => {
        for (const key of Object.keys(DEFAULT_IMPORT_LIMITS) as Array<keyof typeof DEFAULT_IMPORT_LIMITS>) {
            expect(DEFAULT_IMPORT_LIMITS[key]).toBeLessThanOrEqual(IMPORT_LIMIT_CEILINGS[key]);
        }
        expect(PACKAGE_MAX_AGE_DAYS).toBe(400);
    });
});
