import { useSyncExternalStore } from 'react';
import { useFieldDataSource, useFieldSlots } from '../context';

/**
 * Which optional host capabilities the editor may offer an entry point for. A host that leaves a member out gets
 * no entry for it: not a button that fails when pressed, and not a menu that opens onto nothing. Each flag is
 * true exactly when the data source (or host slot) provides what the entry would call.
 */
export interface EditorCapabilities {
  /** The canned-comment library: the `/` and `;` keys, the picker drawer, the side-rail tab, library search. */
  commentsLibrary: boolean;
  /** The cost lines: the header's cost items entry. */
  costItems: boolean;
  /** Version history: the header button, its More-menu row and the panel. */
  versionHistory: boolean;
  /** The video flow: the add-media chooser's video choice and the poster-frame action. */
  video: boolean;
  /** The repair-item catalogue: attaching a repair item to a finding. */
  repairItems: boolean;
  /** The settings sheet: every entry that opens it (header, Template menu, phone More drawer, empty-template call to action). */
  settingsSheet: boolean;
  /** The host's theme switch: the header control and the phone Theme tab. */
  themeControl: boolean;
  /** A camera API on this device (what the burst camera calls): the phone More drawer's Capture group. */
  cameraCapture: boolean;
}

const subscribeNever = () => () => {};
const cameraSnapshot = () => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

export function useEditorCapabilities(): EditorCapabilities {
  const { resources } = useFieldDataSource();
  const { renderThemeControl } = useFieldSlots();
  // A store read with a fixed server snapshot, so the server markup and the first client render agree.
  const cameraCapture = useSyncExternalStore(subscribeNever, cameraSnapshot, () => false);
  return {
    commentsLibrary: resources.commentsLibrary !== undefined,
    costItems: resources.costItems !== undefined,
    versionHistory: resources.versionHistory !== undefined,
    video: resources.video !== undefined,
    repairItems: resources.repairItems !== undefined,
    settingsSheet: resources.settingsSheet !== undefined,
    themeControl: renderThemeControl !== undefined,
    cameraCapture,
  };
}
