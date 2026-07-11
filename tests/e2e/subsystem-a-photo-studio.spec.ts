/**
 * Design System 0520 subsystem A phase 4 — PhotoStudio E2E (Task 4.10).
 *
 * TODO(replaced-component): this spec targeted the original SVG-based, window-
 * event-driven PhotoStudio ("open-photo-studio" CustomEvent, a role=dialog with
 * aria-label "Photo annotation studio", an <svg ellipse>, and a PUT
 * /media/{mediaId}/annotations save). That component has been REPLACED by the
 * react-konva PhotoAnnotator (app/components/media-studio/PhotoAnnotator.tsx):
 *   - it renders shapes to a <canvas> via Konva (Stage/Layer/Circle/Arrow), so
 *     there is NO <svg ellipse> — annotation shapes are not DOM nodes and can't
 *     be asserted with a Playwright selector;
 *   - it opens from React state (the tools-dock "Photo Studio" action or the
 *     item photo gallery via openPhotoStudio), not a window event;
 *   - Save is item-photo-centric: onSave bakes the annotated PNG and persists
 *     through the collab Y.Doc (performPhotoAnnotationSave, keyed by
 *     item + photoIndex), NOT the old /media/{mediaId}/annotations endpoint.
 *
 * A faithful rewrite would have to attach a photo to an item, open the annotator
 * from that item's gallery, drive the Konva canvas by mouse, and assert the
 * collab-doc annotate-save — with no DOM-level shape assertion available. That
 * canvas save path already runs through the same Y.Doc machinery the
 * collab-editing suite (tests/e2e/collab-editing.spec.ts) exercises end to end.
 *
 * Kept as a skip-shell (not deleted) so the PhotoStudio coverage intent stays
 * visible until it is either rewritten against the Konva annotator (accepting a
 * canvas-state signal in place of a DOM shape assertion) or dropped from the
 * plan.
 */
import { test } from '@playwright/test';

test.describe('PhotoStudio MVP (subsystem A M14)', () => {
    test.skip(true, 'SVG PhotoStudio replaced by the Konva PhotoAnnotator — see the TODO above; canvas shapes are not DOM-assertable.');

    test('dispatch open-photo-studio → overlay visible; Circle draws ellipse; Save persists', () => {
        // Intentionally empty — see the skip above.
    });
});
