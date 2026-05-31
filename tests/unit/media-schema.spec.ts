import { describe, it, expect } from 'vitest';
import { UpdateMediaAnnotationsSchema } from '../../server/lib/validations/media.schema';

describe('UpdateMediaAnnotationsSchema', () => {
    it('accepts valid annotations + caption', () => {
        const r = UpdateMediaAnnotationsSchema.safeParse({
            annotations: JSON.stringify({ version: 1, shapes: [] }),
            caption:     'Roof · NE corner',
        });
        expect(r.success).toBe(true);
    });

    it('rejects annotations over 8 KB', () => {
        const big = 'x'.repeat(8 * 1024 + 1);
        const r = UpdateMediaAnnotationsSchema.safeParse({ annotations: big, caption: 'ok' });
        expect(r.success).toBe(false);
    });

    it('rejects caption over 200 chars', () => {
        const long = 'a'.repeat(201);
        const r = UpdateMediaAnnotationsSchema.safeParse({ annotations: '{}', caption: long });
        expect(r.success).toBe(false);
    });

    it('allows empty annotations and empty caption (Reset state)', () => {
        const r = UpdateMediaAnnotationsSchema.safeParse({ annotations: '', caption: '' });
        expect(r.success).toBe(true);
    });

    it('rejects missing fields', () => {
        const r1 = UpdateMediaAnnotationsSchema.safeParse({ annotations: '{}' });
        const r2 = UpdateMediaAnnotationsSchema.safeParse({ caption: 'ok' });
        expect(r1.success).toBe(false);
        expect(r2.success).toBe(false);
    });
});
