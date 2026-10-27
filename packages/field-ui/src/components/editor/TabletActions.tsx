import { useState } from "react";
import { Button, useActionLatch } from "@core/shared-ui";
import { runWithPending } from "./publish-pending";
import { useReadOnly } from "../../read-only";
import { m } from "../../i18n";

export interface TabletActionsProps {
  /** Opens the preview drawer. */
  onPreview: () => void;
  /** The publish pre-flight (readiness check, then the publish dialog). May return a promise. */
  onPublish: () => unknown;
}

/**
 * The tablet top bar's own controls: Preview, and the primary Publish. Publish never hides (as on the desktop
 * header), stays visibly busy while the readiness check is out, and drops a second press in the same frame.
 */
export function TabletActions({ onPreview, onPublish }: TabletActionsProps) {
  const [opening, setOpening] = useState(false);
  const latch = useActionLatch(opening);
  const readOnly = useReadOnly();
  return (
    <>
      <Button variant="ghost" size="sm" className="min-h-11 touch-manipulation" onClick={onPreview}>
        {m.editor_route_drawer_preview()}
      </Button>
      {!readOnly && <Button
        variant="primary"
        size="sm"
        className="min-h-11 touch-manipulation"
        data-testid="tablet-publish-btn"
        pending={opening}
        onClick={() => latch(() => runWithPending(onPublish, setOpening))}
      >
        {opening ? m.report_publish_checking() : m.editor_header_publish()}
      </Button>}
    </>
  );
}
