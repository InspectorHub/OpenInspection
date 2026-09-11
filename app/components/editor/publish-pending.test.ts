/**
 * The three-second Publish button.
 *
 * Pressing Publish in the editor does not open its dialog straight away: the
 * handler first asks the server whether the report is ready. That took about
 * three seconds with no spinner, no label change and no disabled state — a
 * primary action that looks like it ignored the click, on the one button where a
 * second click costs a second publish.
 *
 * The wiring (`EditorHeader` disables the button and swaps its label on the same
 * flag) is asserted in `header-visibility.test.ts`'s sibling source checks below;
 * this file pins the BEHAVIOUR, which is where the two non-obvious rules live.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runWithPending } from './publish-pending';

describe('runWithPending', () => {
    it('marks pending while a promise is in flight and releases it on resolve', async () => {
        let resolve!: () => void;
        const handler = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
        const setPending = vi.fn();

        runWithPending(handler, setPending);
        expect(setPending.mock.calls).toEqual([[true]]);

        resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(setPending.mock.calls).toEqual([[true], [false]]);
    });

    it('releases pending when the promise REJECTS', async () => {
        // The editor's readiness check falls through to opening the dialog when
        // it fails, so a button left disabled by a flaky network would be worse
        // than the delay this exists to explain.
        const handler = () => Promise.reject(new Error('network'));
        const setPending = vi.fn();

        runWithPending(handler, setPending);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(setPending.mock.calls).toEqual([[true], [false]]);
    });

    it('never flips pending for a handler that returns nothing to wait on', () => {
        // The discriminating case: unconditionally setting pending(true) would
        // pass both tests above and leave the button disabled for ever on the
        // synchronous path.
        const setPending = vi.fn();
        runWithPending(() => undefined, setPending);
        expect(setPending).not.toHaveBeenCalled();
    });

    it('calls the handler exactly once', () => {
        const handler = vi.fn(() => undefined);
        runWithPending(handler, vi.fn());
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe('the editor header consumes it on the Publish button', () => {
    // Source-level, like the neighbouring header-visibility checks: this header
    // is not renderable in a unit test (it needs a data router and the whole
    // editor state object), and a behaviour-only test would stay green if the
    // button stopped reading the flag — which is the entire user-visible fix.
    const SRC = readFileSync(join(process.cwd(), 'app', 'components', 'editor', 'EditorHeader.tsx'), 'utf8');

    it('routes the Publish click through runWithPending', () => {
        expect(SRC).toContain('runWithPending(handlePublishClick, setOpeningPublish)');
    });

    it('disables the Publish button and changes its label while the flag is set', () => {
        // From the Publish button's own comment to the end of the file: the two
        // attributes sit either side of its `data-testid`, so slicing at that
        // would read only half the element.
        const start = SRC.indexOf('{/* Publish button */}');
        expect(start).toBeGreaterThan(-1);
        const publishBlock = SRC.slice(start);
        expect(publishBlock).toContain('data-testid="editor-publish-btn"');
        expect(publishBlock).toContain('disabled={openingPublish}');
        expect(publishBlock).toContain('openingPublish ? m.report_publish_checking()');
    });
});
