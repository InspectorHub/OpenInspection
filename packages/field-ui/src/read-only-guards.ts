import type { KeyboardHandlers } from './hooks/useKeyboard';
import type { usePhotoOps } from './hooks/usePhotoOps';

const none = () => undefined;

/**
 * The shortcuts of a read-only editor: moving about, the section picker, fullscreen and the cheat sheet keep working; every
 * key that would write (rate, clear, N/A, photo, save, publish, clone, tags, snippets, Speed mode) does nothing, and the
 * comment library keys are left to the browser as if the host had no library.
 */
export function readOnlyKeyboard(h: KeyboardHandlers): KeyboardHandlers {
  return {
    ...h,
    onRate: none, onClearRating: none, onNARating: none,
    onToggleSpeed: none, onSpeedRate: none, onSpeedNext: none, onSpeedPrev: none, onSpeedOpenEditor: none,
    onOpenLibrary: undefined, onOpenSnippets: undefined, onSaveAsSnippet: undefined, onLibrarySelect: none,
    onPhoto: none, onSave: none, onPublish: none, onCloneLast: none, onOpenTagPicker: none,
  };
}

type PhotoOps = ReturnType<typeof usePhotoOps>;

/**
 * The photo operations of a read-only editor: opening a photo, the viewer and the gallery keep working; the handlers that
 * reorder, detach, move, crop or annotate return before they touch local state, so nothing changes optimistically.
 */
export function guardPhotoOps(ops: PhotoOps, readOnly: boolean): PhotoOps {
  if (!readOnly) return ops;
  return {
    ...ops,
    onReorderPhotos: none, onBulkDetachPhotos: none, onBulkMovePhotos: none, onViewerAction: none, performPhotoCropSave: none,
    performPhotoAnnotationSave: () => true,
  };
}
