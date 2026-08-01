import { Button } from "@core/shared-ui";
import { MobileBottomDrawer } from "~/components/MobileBottomDrawer";
import { m } from "~/paraglide/messages";

export interface MobileFinishDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Runs the publish readiness pre-flight, then opens the publish modal. */
  onPublish: () => void;
  /** Opens the manual signature modal. */
  onSign: () => void;
  /** Opens the per-inspection report settings sheet. */
  onOpenSettings: () => void;
  /** Advisory lifecycle move; null once the fieldwork is already complete. */
  onFinishFieldwork: (() => void) | null;
  /** Whether the finish-fieldwork request is in flight. */
  finishingFieldwork: boolean;
  /** Opens the full web report in a new tab; null when the slug is unknown. */
  onPreviewReport: (() => void) | null;
}

/**
 * The ending the mobile walkthrough was missing.
 *
 * Below 768px the editor renders its own tree — app bar, section/item drawers,
 * item editor — built for walking a property on the device you carry. It had no
 * Publish, no Sign, no Preview and no report settings, and the app bar's own
 * "More actions" button was a comment reading `future: open more menu`. An
 * inspector could complete an entire inspection on a phone and then have no way
 * to finish it.
 *
 * Publish leads because it is what someone opens this for; everything else
 * supports it. Deliberately NOT a port of the desktop action row — search,
 * version history and the template menu are back-office work, and putting them
 * on a phone would bury the one action that matters. For the same reason this
 * opens from the app bar rather than gaining a fifth tab in the bottom nav: a
 * terminal action does not belong in a row of navigation.
 */
export function MobileFinishDrawer({
  open,
  onClose,
  onPublish,
  onSign,
  onOpenSettings,
  onFinishFieldwork,
  finishingFieldwork,
  onPreviewReport,
}: MobileFinishDrawerProps) {
  const run = (fn: () => void) => {
    onClose();
    fn();
  };
  // Short, unlike the section/item drawers this shares a component with: those
  // are scrollable lists that want the height, this is five buttons. At the 0.7
  // default the sheet covered most of the screen with dead space below the last
  // button, which reads as a list that failed to load.
  return (
    <MobileBottomDrawer open={open} onClose={onClose} title={m.editor_mobile_more()} heightFraction={0.42}>
      <div className="p-4 space-y-2">
        <Button variant="primary" className="w-full" onClick={() => run(onPublish)}>
          {m.editor_header_publish()}
        </Button>
        <Button variant="secondary" className="w-full" onClick={() => run(onSign)}>
          {m.editor_header_sign()}
        </Button>
        {onPreviewReport && (
          <Button variant="secondary" className="w-full" onClick={() => run(onPreviewReport)}>
            {m.editor_header_preview_report()}
          </Button>
        )}
        <Button variant="secondary" className="w-full" onClick={() => run(onOpenSettings)}>
          {m.editor_header_settings()}
        </Button>
        {onFinishFieldwork && (
          <Button
            variant="secondary"
            className="w-full"
            disabled={finishingFieldwork}
            onClick={() => run(onFinishFieldwork)}
          >
            {finishingFieldwork ? m.editor_finish_fieldwork_pending() : m.editor_finish_fieldwork()}
          </Button>
        )}
      </div>
    </MobileBottomDrawer>
  );
}
