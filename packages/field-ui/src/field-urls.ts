/** How much picture a caller needs: `thumb` (a tile), `view` (a full-screen viewer) or `original` (a download, or a crop or annotation source). */
export type PhotoSize = 'thumb' | 'view' | 'original';

export interface FieldUrls {
  /**
   * The address of a photo. `size` is an optional hint: a host with smaller copies may return one for `thumb` or
   * `view`; a host without them ignores it and answers as before. `original` is always the exact stored bytes.
   */
  photo(inspectionId: string, key: string, size?: PhotoSize): string;
  /**
   * Optional. `photo()` is synchronous, so a host that can only produce an address later (a photo it fetches and
   * caches, a signed address it renews) calls the listener whenever any photo address may have changed; the editor then
   * asks `photo()` again and its thumbnails, viewer and previews show the new address. Calls may be batched. Returns
   * the unsubscribe function. Absent: addresses are read when the editor renders, as before.
   */
  subscribe?(listener: () => void): () => void;
  /**
   * Optional. The address of the page where the company's tags are made and edited, opened with `openUrl` from the tag picker when the
   * company has no tags yet. Absent or null: the picker only says where to add them.
   */
  tagLibrary?(): string | null;
  reportPreview(tenantSlug: string, inspectionId: string): string | null;
  reportPdf(inspectionId: string): string | null;
  /**
   * The cost tables' download (`csv` or `xlsx`); a plain link the browser follows. Optional: a host with no
   * such download (a native shell) leaves it out and the Cost Items panel shows no export links.
   */
  costExport?(inspectionId: string, format: 'csv' | 'xlsx'): string;
  statutoryPreviewPdf(inspectionId: string): string | null;
  videoObject(inspectionId: string, ref: string): string | null;
  /**
   * The collaborative-presence WebSocket URL (absolute `ws:`/`wss:`). Today
   * `usePresence` builds it from `window.location`.
   */
  presenceSocket(inspectionId: string): string;
  /** The in-app path of this inspection's editor (the publish dialog reads `window.location.pathname`). */
  editorPath(inspectionId: string): string;
  /**
   * The in-app path of the inspection list, which the header's back control points at. Optional: a host
   * without addressable pages (a native shell) leaves it out and the control is a plain button that calls
   * `exit()`. When present the control is a real link (new tab, copy link, link semantics) whose plain
   * left click still goes through `exit()`, so the host's unsaved-changes guard sees the navigation.
   */
  inspectionsList?(): string;
}
