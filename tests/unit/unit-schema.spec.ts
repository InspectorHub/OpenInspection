import { describe, it, expect } from 'vitest';
import { CreateUnitSchema, UpdateUnitSchema, MoveUnitSchema } from '../../server/lib/validations/unit.schema';

describe('CreateUnitSchema (subsystem D P1 T1.3)', () => {
    it('accepts root building', () => {
        expect(CreateUnitSchema.safeParse({ parentUnitId: null, kind: 'building', name: 'A' }).success).toBe(true);
    });

    it('accepts nested floor', () => {
        expect(CreateUnitSchema.safeParse({ parentUnitId: 'building-id', kind: 'floor', name: 'Floor 1' }).success).toBe(true);
    });

    it('rejects unknown kind', () => {
        expect(CreateUnitSchema.safeParse({ parentUnitId: null, kind: 'room', name: 'X' }).success).toBe(false);
    });

    it('rejects empty name', () => {
        expect(CreateUnitSchema.safeParse({ parentUnitId: null, kind: 'building', name: '' }).success).toBe(false);
    });

    it('rejects name > 80 chars', () => {
        expect(CreateUnitSchema.safeParse({ parentUnitId: null, kind: 'building', name: 'x'.repeat(81) }).success).toBe(false);
    });
});

describe('UpdateUnitSchema', () => {
    it('accepts rename', () => {
        expect(UpdateUnitSchema.safeParse({ name: 'New' }).success).toBe(true);
    });
    it('accepts sortOrder-only', () => {
        expect(UpdateUnitSchema.safeParse({ sortOrder: 5 }).success).toBe(true);
    });
    it('accepts empty object (no-op)', () => {
        expect(UpdateUnitSchema.safeParse({}).success).toBe(true);
    });
    it('rejects negative sortOrder', () => {
        expect(UpdateUnitSchema.safeParse({ sortOrder: -1 }).success).toBe(false);
    });
});

describe('MoveUnitSchema', () => {
    it('accepts move to root (null parent)', () => {
        expect(MoveUnitSchema.safeParse({ newParentUnitId: null, newSortOrder: 0 }).success).toBe(true);
    });
    it('accepts move under another node', () => {
        expect(MoveUnitSchema.safeParse({ newParentUnitId: 'other-id', newSortOrder: 5 }).success).toBe(true);
    });
    it('rejects empty newParentUnitId string', () => {
        expect(MoveUnitSchema.safeParse({ newParentUnitId: '', newSortOrder: 0 }).success).toBe(false);
    });
});
