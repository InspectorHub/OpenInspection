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
            expect(rules('<Form method="post" onSubmit={latch()}><div><button>Save</button></div></Form>')).toEqual(['submit-unprotected']);
            expect(rules('<fetcher.Form method="post" onSubmit={latch()}><button>Save</button></fetcher.Form>')).toEqual(['submit-unprotected']);
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

    describe('form-without-latch (per form: the guard must be reachable from that form)', () => {
        const nl = String.fromCharCode(10);
        it.each([
            ['fetcher.Form', '<fetcher.Form method="post"><input /></fetcher.Form>'],
            ['a member .Form', '<save.Form method="put"><input /></save.Form>'],
            ['<Form method="post">', '<Form method="post"><input /></Form>'],
            ['<form onSubmit>', '<form onSubmit={go}><input /></form>'],
            ['a dynamic method', '<Form method={m}><input /></Form>'],
        ])('flags %s with no guard reachable', (_n, src) => {
            expect(rules(src)).toEqual(['form-without-latch']);
        });
        it('is clean when the form tag itself calls a guard', () => {
            expect(rules('<Form method="post" onSubmit={latch()}><input /></Form>')).toEqual([]);
            expect(rules('<form onSubmit={(e) => { if (saveInFlight.current) e.preventDefault(); }}><input /></form>')).toEqual([]);
            expect(rules('<form onSubmit={latchSubmit(go)}><input /></form>')).toEqual([]);
        });
        it('is clean when the named handler reaches a guard, directly or through one more function', () => {
            expect(rules('function onSubmit(e) { e.preventDefault(); latch(confirm); }' + nl + '<form onSubmit={onSubmit}><input /></form>')).toEqual([]);
            expect(rules('const { submit } = useGuardedSubmit();' + nl + 'function save() { submit(x); }' + nl + '<form onSubmit={save}><input /></form>')).toEqual([]);
            expect(rules('const h = useSubmitLatch(s);' + nl + 'const go = h();' + nl + '<form onSubmit={go}><input /></form>')).toEqual([]);
        });
        it('FLAGS a file that names a guard but does not wire it to this form (the old coarse pass)', () => {
            expect(rules('const l = useSubmitLatch(go);' + nl + '<Form method="post"><input /></Form>')).toEqual(['form-without-latch']);
            expect(rules('const l = useSubmitLatch(go);' + nl + '<form onSubmit={go}><input /></form>')).toEqual(['form-without-latch']);
        });
        it('two forms, one latch: the wired one is clean and the unwired one is flagged', () => {
            const v = run('const l = useSubmitLatch(s);' + nl + '<Form method="post" onSubmit={l()}><input /></Form>' + nl + '<fetcher.Form method="post" />').violations;
            expect(v.map((x) => x.line)).toEqual([3]);
        });
        it('does not flag a GET form or a form with neither method nor onSubmit', () => {
            expect(rules('<Form method="get"><input /></Form>')).toEqual([]);
            expect(rules("<form method={'GET'}><input /></form>")).toEqual([]);
            expect(rules('<Form action="/x"><input /></Form>')).toEqual([]);
        });
        it('still flags when the guard is named only in a comment or a string', () => {
            expect(rules('// useSubmitLatch lives in the parent' + nl + '<Form method="post" />')).toEqual(['form-without-latch']);
            expect(rules('/* latch( */ <form onSubmit={go} />')).toEqual(['form-without-latch']);
            expect(rules('const s = "useActionLatch inFlight";' + nl + '<form onSubmit={s}><input /></form>')).toEqual(['form-without-latch']);
            expect(rules('function go() { const s = "latch()"; }' + nl + '<form onSubmit={go} />')).toEqual(['form-without-latch']);
        });
        it('honours the allow marker with a reason, not an empty one', () => {
            expect(rules('{/* busy-controls-allow: idempotent upload */}' + nl + '<Form method="post" />')).toEqual([]);
            expect(rules('{/* busy-controls-allow: */}' + nl + '<Form method="post" />')).toEqual(['form-without-latch']);
        });
        it('reports the form tag line, once per unprotected form', () => {
            const v = run('const a = 1;' + nl + '<Form method="post"/>' + nl + '<form onSubmit={go}/>').violations;
            expect(v.map((x) => x.line)).toEqual([2, 3]);
        });
    });

    describe('raw-submit-unlatched (a fetcher.submit with no form to latch)', () => {
        const nl = String.fromCharCode(10);
        it('flags a handler that calls fetcher.submit with no guard reachable', () => {
            expect(rules('function send() { emailFetcher.submit(fd, { method: "post" }); }')).toEqual(['raw-submit-unlatched']);
            expect(rules('const send = () => { saveFetcher.submit(fd, { method: "put" }); };')).toEqual(['raw-submit-unlatched']);
            expect(rules('<Button onClick={() => coverFetcher.submit(fd, { method: "delete" })} />')).toEqual(['raw-submit-unlatched']);
        });
        it('is clean when the calling function reaches a guard', () => {
            expect(rules('function send() { latch(() => emailFetcher.submit(fd, { method: "post" })); }')).toEqual([]);
            expect(rules('const send = () => { if (inFlight.current) return; inFlight.current = true; emailFetcher.submit(fd, { method: "post" }); };')).toEqual([]);
            expect(rules('function C() { const saveLatch = useActionLatch(b); const send = () => saveLatch(() => saveFetcher.submit(fd, { method: "post" })); return null; }')).toEqual([]);
        });
        it('is clean when the function is handed to a guard by name, even though the guard is called elsewhere', () => {
            expect(rules('function C() { const emailLatch = useActionLatch(b); const sendEmail = () => { emailFetcher.submit(fd, { method: "post" }); }; return <B onClick={() => emailLatch(sendEmail)} />; }')).toEqual([]);
            expect(rules('function C() { const sendEmail = () => { emailFetcher.submit(fd, { method: "post" }); }; return <B onClick={sendEmail} />; }')).toEqual(['raw-submit-unlatched']);
        });
        it('does not let a guard elsewhere in the same COMPONENT cover a handler', () => {
            expect(rules(['function C({ a }: P) {', '  const l = useActionLatch(b);', '  const other = () => l(x);', '  const send = () => {', '    saveFetcher.submit(fd, { method: "post" });', '  };', '  return null;', '}'].join(String.fromCharCode(10)))).toEqual(['raw-submit-unlatched']);
        });
        it('does not mistake the guarded hook\'s plain submit( for a raw fetcher call', () => {
            expect(rules('const { submit } = useGuardedSubmit();' + nl + 'function go() { submit(fd); }')).toEqual([]);
        });
        it('flags a bare fetch( that writes, and not one that reads', () => {
            expect(rules('async function go() { await fetch("/x", { method: "POST", body }); }')).toEqual(['raw-submit-unlatched']);
            expect(rules('async function go() { await fetch("/x"); }')).toEqual([]);
            expect(rules('async function go() { await fetch("/x", { method: "GET" }); }')).toEqual([]);
            expect(rules('async function go() { await latch(() => fetch("/x", { method: "post" })); }')).toEqual([]);
        });
        it('an allow marker above the STATEMENT covers a call that is not the first token of it', () => {
            const src = ['async function go() {', '  // busy-controls-allow: a repeat deletes nothing the second time', '  const res = await fetch("/x", { method: "DELETE" });', '}'].join(String.fromCharCode(10));
            expect(rules(src)).toEqual([]);
            expect(rules(src.replace('busy-controls-allow: a repeat deletes nothing the second time', 'no marker here'))).toEqual(['raw-submit-unlatched']);
        });
        it('does not flag a read: a submit with no method, or an explicit GET, is a search or a load', () => {
            expect(rules('function find() { searchFetcher.submit(fd); }')).toEqual([]);
            expect(rules('function find() { searchFetcher.submit({ q }, { method: "get" }); }')).toEqual([]);
        });
        it('flags a method that is not a literal, since it may write', () => {
            expect(rules('function s() { saveFetcher.submit(fd, { method: verb }); }')).toEqual(['raw-submit-unlatched']);
        });
        it('a guard in ANOTHER function of the same file does not cover this one', () => {
            expect(rules('function a() { latch(x); }' + nl + 'function b() { saveFetcher.submit(fd, { method: "post" }); }')).toEqual(['raw-submit-unlatched']);
        });
        it('honours the allow marker with a reason', () => {
            expect(rules('function s() {' + nl + '// busy-controls-allow: the server short-circuits a repeat' + nl + 'saveFetcher.submit(fd, { method: "post" }); }')).toEqual([]);
        });
    });
});
