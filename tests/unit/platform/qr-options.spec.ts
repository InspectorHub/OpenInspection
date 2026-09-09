/**
 * The options handed to `qrToSvg` actually reach the renderer.
 *
 * This module exists because of a packaging quirk: `qrcode`'s server entry
 * statically requires the PNG renderer, whose `util.inherits(..., zlib.Inflate)`
 * crashes under the workerd Node shims, so we deep-import the pure core and the
 * svg-tag renderer instead. The options object is passed straight through to a
 * renderer we reach past the package's own entry point — undocumented ground,
 * and exactly the kind of pass-through a package upgrade can break silently.
 *
 * ⚠️ WHY THIS SPEC EXISTS AT ALL. The field-level census reported
 * `QrSvgOptions.margin` as unread, because nothing in this repository writes
 * `.margin`. The conclusion "the option is offered and ignored" was wrong and
 * would have been a fix for a defect that does not exist — measured first: the
 * renderer honours it, a margin of 0 gives a 21-module viewBox and a margin of 8
 * gives 37. The census entry is now `invisible-read`, and this pins the fact so
 * the next reader does not have to re-measure it.
 *
 * The quiet zone is not decoration: it is the blank border a scanner needs to
 * find the code's edges against whatever is printed around it.
 */
import { describe, it, expect } from 'vitest';

import { qrToSvg, qrToSvgDataUri } from '../../../server/lib/qr';

/** The `w h` of the SVG's viewBox, in modules. */
function viewBox(svg: string): string {
    return (/viewBox="([^"]+)"/.exec(svg) ?? [])[1] ?? '';
}

describe('qrToSvg options', () => {
    it('honours the quiet-zone margin', () => {
        const none = viewBox(qrToSvg('hello', { margin: 0 }));
        const wide = viewBox(qrToSvg('hello', { margin: 8 }));
        expect(none).not.toBe(wide);
        // The same code, plus the margin on each of the four sides.
        expect(none).toBe('0 0 21 21');
        expect(wide).toBe('0 0 37 37');
    });

    // POSITIVE CONTROL: the two assertions above would also hold if the renderer
    // ignored the payload and sized itself from the margin alone.
    it('still encodes the text, so the size is not the whole story', () => {
        const short = viewBox(qrToSvg('hi', { margin: 0 }));
        const long = viewBox(qrToSvg('a'.repeat(200), { margin: 0 }));
        expect(short).not.toBe(long);
    });

    it('carries the same options through the data-URI wrapper', () => {
        const uri = qrToSvgDataUri('hello', { margin: 0 });
        expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
        expect(atob(uri.slice('data:image/svg+xml;base64,'.length))).toContain('viewBox="0 0 21 21"');
    });
});
