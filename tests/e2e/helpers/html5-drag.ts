/**
 * HTML5 drag-and-drop for Playwright.
 *
 * Playwright's `locator.dragTo()` and any hand-rolled `mouse.down/move/up`
 * synthesize POINTER events. `dragstart` / `dragover` / `drop` are browser-native
 * gestures the automation protocol does not initiate, so they are simply never
 * emitted — a surface built on HTML5 DnD sits perfectly still and the spec reads
 * as a product bug rather than a harness gap.
 *
 * The dispatch board (and the calendar's day/week/month views) are built on
 * HTML5 DnD and read the dragged id back off `dataTransfer`, so a spec that
 * cannot produce a real `DataTransfer` cannot exercise them at all.
 *
 * What this does instead: construct one `DataTransfer` in the page, stash it on
 * `window`, and dispatch each real `DragEvent` against it in turn. The stash is
 * what makes it a GESTURE rather than four unrelated events — the drop handler
 * reads back exactly what the dragstart handler wrote, which is the contract
 * under test.
 *
 * The four steps are dispatched in SEPARATE evaluate round trips on purpose.
 * Fired in one synchronous block, React never re-renders between them, so
 * anything driven by state set in `dragstart` (the board's hover indicator, and
 * its `onDragOver` early-return) is dead. Separate trips let the render land,
 * which is what a real drag does across frames.
 */
import type { Locator, Page } from '@playwright/test';

/** Where the gesture's DataTransfer lives while the drag is in flight. */
const STASH = '__e2eHtml5DragDataTransfer';

interface Point {
    clientX: number;
    clientY: number;
}

type Win = Window & { [STASH]?: DataTransfer };

export async function dragStart(source: Locator): Promise<void> {
    await source.evaluate((el, stash) => {
        const dt = new DataTransfer();
        (window as unknown as Record<string, DataTransfer>)[stash] = dt;
        el.dispatchEvent(
            new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }),
        );
    }, STASH);
}

async function dispatchAt(target: Locator, type: 'dragover' | 'drop', point: Point): Promise<void> {
    await target.evaluate(
        (el, args) => {
            const dt = (window as unknown as Record<string, DataTransfer | undefined>)[args.stash];
            if (!dt) throw new Error(`html5-drag: no DataTransfer in flight — call dragStart first`);
            el.dispatchEvent(
                new DragEvent(args.type, {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: dt,
                    clientX: args.clientX,
                    clientY: args.clientY,
                }),
            );
        },
        { stash: STASH, type, clientX: point.clientX, clientY: point.clientY },
    );
}

export const dragOver = (target: Locator, point: Point) => dispatchAt(target, 'dragover', point);
export const drop = (target: Locator, point: Point) => dispatchAt(target, 'drop', point);

export async function dragEnd(source: Locator): Promise<void> {
    await source.evaluate((el, stash) => {
        const w = window as unknown as Win;
        el.dispatchEvent(
            new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: w[stash] }),
        );
        delete w[stash];
    }, STASH);
}

/**
 * Drag `source` onto `target`, dropping `offsetY` pixels below the target's top
 * edge.
 *
 * The offset is the whole point on a time axis: a board reads the drop MINUTE
 * out of `clientY - targetRect.top`, so a drop with no meaningful vertical
 * position is not a time. Callers that need two drops to land on the SAME
 * instant should pass the same `offsetY` rather than computing a minute — the
 * board's own geometry then guarantees the equality.
 */
export async function html5DragTo(
    page: Page,
    source: Locator,
    target: Locator,
    offsetY: number,
): Promise<void> {
    const box = await target.boundingBox();
    if (!box) throw new Error('html5-drag: drop target has no bounding box');
    const point = { clientX: box.x + box.width / 2, clientY: box.y + offsetY };

    await dragStart(source);
    await dragOver(target, point);
    await drop(target, point);
    await dragEnd(source);
    // The drop fires a fetcher submit; give the router a tick to enter its
    // pending state before the caller starts asserting on the outcome.
    await page.waitForTimeout(100);
}
