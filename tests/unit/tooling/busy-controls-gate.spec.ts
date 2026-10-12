import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs helper, no types alongside it (same as the other tooling specs).
import { detectBusyControls } from '../../../scripts/lib/busy-controls-detect.mjs';

interface Hit { line: number; rule: string }
const run = (src: string) => detectBusyControls(src) as { sites: number; submits: number; violations: Hit[] };
const rules = (src: string) => run(src).violations.map((v) => v.rule);

/**
 * Every violation shape is paired with a clean control: a detector that flags nothing
 * passes the clean cases, and one that flags everything passes the violation cases.
 */
describe('busy-controls detector', () => {
    describe('submit without busy protection', () => {
        it('flags a bare <button type="submit">', () => {
            expect(rules('<button type="submit">Save</button>')).toEqual(['submit-unprotected']);
        });
        it('flags <Button type="submit"> and type={"submit"}', () => {
            expect(rules('<Button variant="primary" type="submit">Save</Button>')).toEqual(['submit-unprotected']);
            expect(rules("<button type={'submit'}>Save</button>")).toEqual(['submit-unprotected']);
        });
        it('reads a multi-line tag with nested braces and reports its first line', () => {
            const src = 'const a = 1;\n<Button\n  onClick={() => { go({ a: 1 }); }}\n  className={`x ${y ? "a" : "b"}`}\n  type="submit"\n>\n  Save\n</Button>';
            const v = run(src).violations;
            expect(v).toHaveLength(1);
            expect(v[0].line).toBe(2);
        });
        it.each([
            ['pending', '<Button type="submit" pending={busy}>Save</Button>'],
            ['pendingProps spread', '<button type="submit" {...pendingProps(busy)} className={PENDING_CLASS}>Save</button>'],
            ['disabled', '<button type="submit" disabled={!valid}>Save</button>'],
            ['aria-disabled', '<button type="submit" aria-disabled={!valid}>Save</button>'],
            ['aria-busy', '<button type="submit" aria-busy={busy || undefined}>Save</button>'],
        ])('does not flag a submit protected by %s', (_n, src) => {
            expect(rules(src)).toEqual([]);
        });
        it('does not flag a non-submit button, nor type="button"', () => {
            expect(rules('<button onClick={go}>Go</button><button type="button">x</button>')).toEqual([]);
        });
        it('counts the submit as a scanned candidate even when it is clean', () => {
            const r = run('<button type="submit" disabled={!ok}>Save</button>');
            expect(r.submits).toBe(1);
            expect(r.sites).toBe(1);
            expect(r.violations).toEqual([]);
        });
    });

    describe('native disable while busy', () => {
        it.each([
            'submitting', 'isSubmitting', 'saving', 'busy', 'loading', 'isPending', 'sending', 'uploading', 'deleting', 'working',
        ])('flags disabled={%s}', (id) => {
            expect(rules(`<Button disabled={${id}}>Go</Button>`)).toEqual(['native-disable-busy']);
        });
        it('flags a busy identifier inside a compound expression and a fetcher state test', () => {
            expect(rules('<button disabled={busy || rows.length === 1}>x</button>')).toEqual(['native-disable-busy']);
            expect(rules('<button disabled={fetcher.state !== "idle"}>x</button>')).toEqual(['native-disable-busy']);
        });
        it('does not flag disabled for a non-busy reason', () => {
            expect(rules('<Button disabled={!name.trim()}>Go</Button>')).toEqual([]);
            expect(rules('<button disabled={recipients.length === 0}>Go</button>')).toEqual([]);
        });
        it('does not flag the repo convention: pending / pendingProps', () => {
            expect(rules('<Button pending={saving}>Go</Button>')).toEqual([]);
            expect(rules('<button {...pendingProps(saving, go)}>Go</button>')).toEqual([]);
        });
        it('does not flag a busy word that is only element text, not the disabled value', () => {
            expect(rules('<button disabled={!ok}>{saving ? "Saving" : "Save"}</button>')).toEqual([]);
        });
    });

    describe('what is not JSX', () => {
        it('ignores a commented-out button', () => {
            expect(rules('// <button type="submit">x</button>\n/* <Button disabled={busy}>y</Button> */')).toEqual([]);
        });
        it('ignores button markup inside a plain string', () => {
            expect(rules('const s = \'<button type="submit">\'; const t = "<Button disabled={busy}>";')).toEqual([]);
        });
        it('a > inside an attribute string does not end the tag early', () => {
            expect(rules('<button title="a > b" type="submit">x</button>')).toEqual(['submit-unprotected']);
            expect(rules('<button title="a > b" type="submit" disabled={!ok}>x</button>')).toEqual([]);
        });
    });

    describe('exception marker', () => {
        it('honours a marker with a reason above the tag', () => {
            expect(rules('// busy-controls-allow: navigation, the page unloads\n<button type="submit">Go</button>')).toEqual([]);
            expect(rules('{/* busy-controls-allow: a pure toggle */}\n<Button disabled={loading}>x</Button>')).toEqual([]);
        });
        it('ignores a marker with no reason', () => {
            expect(rules('// busy-controls-allow:\n<button type="submit">Go</button>')).toEqual(['submit-unprotected']);
        });
        it('does not let a marker far above exempt a later tag', () => {
            expect(rules('// busy-controls-allow: ok\n\n\n\n<button type="submit">Go</button>')).toEqual(['submit-unprotected']);
        });
    });
});
