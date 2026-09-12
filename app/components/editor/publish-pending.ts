/**
 * Keep a primary action visibly busy while the work it kicked off is in flight.
 *
 * Written for the editor's Publish button, which does not open its dialog
 * immediately: it first asks the server whether the report is ready to publish.
 * That round trip took about three seconds, during which the button showed no
 * spinner, no label change and no disabled state — so the most consequential
 * control in the product looked like it had ignored the click, which is an
 * invitation to click it again.
 *
 * Two properties, and both are load-bearing:
 *
 *  - **A handler that returns no promise changes nothing.** There is no pending
 *    state to show for work that already finished, and a flag that switched on
 *    and off inside one render would only flicker.
 *  - **The flag is released on rejection too.** A readiness check that fails is
 *    exactly when the user needs the button back: the editor's handler falls
 *    through to opening the dialog rather than blocking on a flaky check, so a
 *    button left disabled by a network error would be the worse outcome of the
 *    two.
 */
export function runWithPending(
    handler: () => unknown,
    setPending: (pending: boolean) => void,
): void {
    const result: unknown = handler();
    const thenable = result as { then?: unknown } | null | undefined;
    if (typeof thenable?.then !== 'function') return;
    setPending(true);
    const release = () => setPending(false);
    void Promise.resolve(result).then(release, release);
}
