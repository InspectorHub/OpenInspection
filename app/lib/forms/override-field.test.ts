/**
 * #270 — `overrideFieldFromForm` and the reason it exists.
 *
 * The bug it fixes was invisible in every unit test and every type: the profile
 * action read the CONFORM-PARSED value, and `parseWithZod` maps an empty string
 * to `undefined`. For an inherit-or-override <select>, `''` is not absence — it
 * is the instruction to clear. So "Use workspace default" dropped the key out of
 * the PATCH body entirely and the stale override survived the save. Caught only
 * by clicking it in Chrome.
 *
 * The distinction under test is therefore three-valued, not two: clear (''),
 * set (a value), and leave alone (key absent).
 */
import { describe, it, expect } from 'vitest';
import { parseWithZod } from '@conform-to/zod/v4';
import { makeProfileSchema, overrideFieldFromForm } from './settings.schema';

function form(entries: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.append(k, v);
    return fd;
}

describe('overrideFieldFromForm', () => {
    it('returns the empty string when the control submitted "inherit"', () => {
        expect(overrideFieldFromForm(form({ dateFormat: '' }), 'dateFormat')).toBe('');
    });

    it('returns the chosen value when the control submitted one', () => {
        expect(overrideFieldFromForm(form({ dateFormat: 'eu' }), 'dateFormat')).toBe('eu');
    });

    it('returns undefined only when the control was not on the form', () => {
        expect(overrideFieldFromForm(form({ name: 'Dana' }), 'dateFormat')).toBeUndefined();
    });

    it('is the reason the parsed submission cannot be used for these fields', () => {
        // This is the defect itself, asserted so nobody "simplifies" the action
        // back to reading submission.value. If this assertion ever flips,
        // Conform changed and the helper can be revisited — but until then,
        // clear and leave-alone are the same value on the parsed side.
        const submission = parseWithZod(form({ timezone: '', locale: '', dateFormat: '', timeFormat: '' }), {
            schema: makeProfileSchema(),
        });
        expect(submission.status).toBe('success');
        const value = submission.status === 'success' ? submission.value : {};
        expect(value.dateFormat).toBeUndefined();
        expect(value.timezone).toBeUndefined();
        // …while the raw form still carries the clear signal for all four.
        const fd = form({ timezone: '', locale: '', dateFormat: '', timeFormat: '' });
        for (const key of ['timezone', 'locale', 'dateFormat', 'timeFormat']) {
            expect(overrideFieldFromForm(fd, key)).toBe('');
        }
    });
});
