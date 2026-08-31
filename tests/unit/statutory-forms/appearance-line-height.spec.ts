import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * What pdf-lib actually steps between baselines in a generated appearance.
 *
 * -- WHY THIS TEST EXISTS ----------------------------------------------------
 * `fit.ts` refuses a value that would not fit its widget. It used to measure
 * with `font.heightAtSize(size)` -- Helvetica's ascender-minus-descender,
 * 0.925 em -- and pdf-lib's appearance generator steps 1.11 em. The check
 * therefore passed text that the produced document then CLIPPED: measured on a
 * real Texas inspection, ten comment fields came out with their last line
 * sliced horizontally.
 *
 * ⚠️ AND NOTHING ELSE COULD SEE IT. `getText()` on the saved document returns
 * the whole value, so every assertion about field contents passed. Only a
 * rasteriser shows the cut. That is why the fix is a constant and this is a
 * measurement: a number nobody re-measures is a number that goes stale, and
 * this one going stale means shipping a sliced official document again.
 *
 * If pdf-lib changes its layout, THIS fails -- not a form, and not silently.
 */
const SIZE = 10;

/**
 * pdf-lib's own arithmetic, quoted from `cjs/api/text/layout.js`:
 *
 *     var height = font.heightAtSize(fontSize);
 *     var lineHeight = height + height * 0.2;
 *
 * The test below does not re-derive it -- it renders a real field and checks
 * that what pdf-lib DID matches what `fit.ts` ASSUMES. If pdf-lib changes the
 * 0.2, this fails; nothing else in the tree would notice.
 */
const LINE_GAP = 1.2;

describe('pdf-lib appearance line height', () => {
    it('steps heightAtSize x 1.2 between baselines, which is what fit.ts budgets', async () => {
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const page = doc.addPage([400, 200]);
        const form = doc.getForm();
        const field = form.createTextField('probe');
        field.enableMultiline();
        field.setText(
            'One two three four five six seven eight nine ten eleven twelve '
            + 'thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty',
        );
        field.addToPage(page, { x: 10, y: 10, width: 380, height: 40, font });
        field.setFontSize(SIZE);
        field.defaultUpdateAppearances(font);

        // pdf-lib exposes the laid-out lines through the same helper its
        // appearance provider uses, so this reads what it will actually draw
        // rather than parsing bytes back out of a saved file.
        const { layoutMultilineText, TextAlignment } = await import('pdf-lib');
        const laid = layoutMultilineText(field.getText() ?? '', {
            alignment: TextAlignment.Left,
            fontSize: SIZE,
            font,
            bounds: { x: 1, y: 1, width: 378, height: 38 },
        });

        expect(laid.lines.length, 'the probe must wrap onto at least two lines')
            .toBeGreaterThan(1);

        const ys = laid.lines.map((l) => l.y);
        const steps = ys.slice(1).map((y, i) => Math.abs(y - ys[i]));
        for (const step of steps) {
            expect(step).toBeCloseTo(font.heightAtSize(SIZE) * LINE_GAP, 3);
        }

        // The measurement that was wrong, kept as the contrast: heightAtSize is
        // a FONT metric and the layout uses a LAYOUT one. 9.25 vs 11.1 at size
        // 10 -- 20% of every line, which is what clipped ten real fields.
        expect(font.heightAtSize(SIZE)).toBeLessThan(steps[0]);
        expect(steps[0] / font.heightAtSize(SIZE)).toBeCloseTo(LINE_GAP, 3);
    });
});
