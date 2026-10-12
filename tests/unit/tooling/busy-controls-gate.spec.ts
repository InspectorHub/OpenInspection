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
        ])('does not flag a submit protected by %s', (_n, src) => {
            expect(rules(src)).toEqual([]);
        });
        it.each([
            ['aria-disabled', '<button type="submit" aria-disabled={!valid}>Save</button>'],
            ['aria-busy', '<button type="submit" aria-busy={busy || undefined}>Save</button>'],
        ])('flags a submit that only has %s: it blocks neither a click nor Enter in a field', (_n, src) => {
            expect(rules(src)).toEqual(['submit-unprotected']);
        });
        it('allows such a submit when a marker states why the form handler guards it', () => {
            const src = ['{/* busy-controls-allow: onSubmit drops a submit while busy */}', '<button type="submit" aria-disabled={busy}>Save</button>'].join(String.fromCharCode(10));
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

    describe('submit written other than as a literal', () => {
        it('flags a conditional type and a template-literal type', () => {
            expect(rules('<button type={ok ? "submit" : "button"}>Save</button>')).toEqual(['submit-unprotected']);
            expect(rules('<button type={`submit`}>Save</button>')).toEqual(['submit-unprotected']);
        });
        it('does not flag a type expression that never says submit, and honours protection on the dynamic one', () => {
            expect(rules('<button type={kind}>Save</button>')).toEqual([]);
            expect(rules('<button type={ok ? "submit" : "button"} pending={busy}>Save</button>')).toEqual([]);
        });
    });

    describe('a bare <button> inside a form defaults to submit', () => {
        it('flags a <button> with no type inside <form>, <Form> and fetcher.Form', () => {
            expect(rules('<form><button>Save</button></form>')).toEqual(['submit-unprotected']);
            expect(rules('<Form method="post"><div><button>Save</button></div></Form>')).toEqual(['submit-unprotected']);
            expect(rules('<fetcher.Form method="post"><button>Save</button></fetcher.Form>')).toEqual(['submit-unprotected']);
        });
        it('does not flag it when protected, typed as button, outside the form, or a shared-ui <Button>', () => {
            expect(rules('<form><button disabled={!ok}>Save</button></form>')).toEqual([]);
            expect(rules('<form><button type="button">Cancel</button></form>')).toEqual([]);
            expect(rules('<form></form><button>Save</button>')).toEqual([]);
            expect(rules('<form><Button>Save</Button></form>')).toEqual([]);
        });
        it('does not flag a button after a self-closing form or one that sits in a sibling element', () => {
            expect(rules('<Form action="/x" /><button>Go</button>')).toEqual([]);
            expect(rules('<div><form><input /></form><button>Go</button></div>')).toEqual([]);
        });
        it('counts such a button as a submit candidate', () => {
            expect(run('<form><button disabled={!ok}>Save</button></form>').submits).toBe(1);
        });
    });

    describe('busy words are matched as whole identifiers', () => {
        it('does not flag a comparison against a string literal', () => {
            expect(rules('<button disabled={inv.status !== "pending"}>x</button>')).toEqual([]);
            expect(rules("<button disabled={status === 'loading'}>x</button>")).toEqual([]);
        });
        it('does not flag a longer word that merely contains a busy word', () => {
            expect(rules('<button disabled={unbusyness}>x</button>')).toEqual([]);
            expect(rules('<button disabled={loadingzone}>x</button>')).toEqual([]);
        });
        it.each([
            'creating', 'syncing', 'processing', 'connecting', 'starting', 'updating', 'removing', 'revoking',
            'isBusy', 'inFlight', 'isRevoking', 'revoking_id', 'state.isSyncing',
        ])('flags disabled={%s}', (id) => {
            expect(rules(`<button disabled={${id}}>x</button>`)).toEqual(['native-disable-busy']);
        });
        it('still flags a busy identifier next to a string comparison on another operand', () => {
            expect(rules('<button disabled={busy || kind === "pending"}>x</button>')).toEqual(['native-disable-busy']);
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
        it('ignores a marker whose reason is only the comment terminator, or that sits in a string', () => {
            expect(rules('{/* busy-controls-allow: */}\n<button type="submit">Go</button>')).toEqual(['submit-unprotected']);
            expect(rules('<button title="busy-controls-allow: x" type="submit">Go</button>')).toEqual(['submit-unprotected']);
        });
        it('exempts only the next tag, not the ones after it', () => {
            const src = '{/* busy-controls-allow: ok */}\n<button type="submit">A</button>\n<button type="submit">B</button>';
            expect(run(src).violations.map((v) => v.line)).toEqual([3]);
        });
    });
});
