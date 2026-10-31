import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type * as Y from "yjs";
import { resolvePhotoDisplayKey, clearAnnotationOnRecrop } from "../components/media-studio/photo-display-key";
import type { MediaAction } from "../components/media-studio/MediaViewer";
import { streamThumbUrl } from "../components/media-studio/PosterPicker";
import type { GalleryPhoto } from "../shared/inspection-media";
import { findingKey } from "./findings/shared";
import type { PhotoCrop } from "../components/media-studio/PhotoCropper";
import type { StoredCoverCrop } from "../components/media-studio/CoverCropper";
import type { useInspectionState } from "./useInspection";
import type { useFindings } from "./useFindings";
import {
  reorderPhotos as bindingReorderPhotos,
  movePhoto as bindingMovePhoto,
  removePhoto as bindingRemovePhoto,
  revertPhoto as bindingRevertPhoto,
  setPhotoCrop as bindingSetPhotoCrop,
  setPhotoAnnotation as bindingSetPhotoAnnotation,
  markPhotoPending as bindingMarkPhotoPending,
} from "../collab/results-binding";
import { useFieldDataSource, usePhotoUrlVersion } from "../context";
import { freeVideoMedia, videoEntryIdentity } from "../lib/video-media-delete";
import { removeMediaBy as bindingRemoveMediaBy } from "../shared/results-doc-media";
import { m } from "../i18n";
import { enqueueMedia } from "../collab/media-upload-queue";
import type { PendingMediaRecord } from "../media-types";
import type { PhotoEntry } from "../shared/results-doc.types";
import { dropMediaSave, guardedSave, refuseInadmissibleImage, type OnChecked } from "./photo-save-guard";

/**
 * The photo / media-operations cluster of the inspection editor. Behavior-
 * preserving extraction (Batch 4): all the photo overlay UI state, the dedicated
 * photoOps fetcher, the per-item photo read/map helpers, and the viewer-action /
 * crop / reorder / detach / move mutations live here. The component destructures
 * the returned members back into the same local names so every downstream
 * reference (overlays, ItemList, MediaViewer, PhotoCropper, etc.) is unchanged.
 *
 * Component-local values that the moved bodies reference but don't own —
 * `state`, `findings`, and the loader-derived `streamCustomerSubdomain` (used
 * elsewhere in the component too) — are threaded in via the single `ctx` param.
 * Module-level helpers are imported directly.
 */
export function usePhotoOps(ctx: {
  state: ReturnType<typeof useInspectionState>;
  findings: ReturnType<typeof useFindings>;
  streamCustomerSubdomain: string | null;
  // #181 — the Y.Doc is the authoritative writer of inspection_results.data (the
  // DO persists projectResults(doc) to D1). Photo ARRAY ops mutate the doc; the
  // binary R2/Stream calls (upload, crop/annotation bake, video delete) remain
  // network ops. null only in the brief pre-connect window before the doc syncs.
  collabDoc: Y.Doc | null;
  // Phase U (Batch C2a) — the editor's active per-unit scope. `null` (default) =
  // the `_default` common scope, so the composite finding keys this hook builds
  // (patchItemPhotos optimistic write + docFindingKey doc write) are
  // byte-identical to before. When a unit is active, photo ops key ONLY that
  // unit's finding and never alias the ambiguous bare itemId slot.
  activeUnitId: string | null;
  // PhotoAnnotator (Photo Studio) overlay setters — owned by the component; the
  // annotate branch of onViewerAction opens that overlay. Threaded so the moved
  // body stays byte-identical (these setters are stable, so deps are unaffected).
  setPhotoStudioUrl: (v: string | null) => void;
  setPhotoStudioKey: (v: string | null) => void;
  setPhotoStudioIndex: (v: number) => void;
  setPhotoStudioTotal: (v: number) => void;
  setPhotoStudioOpen: (v: boolean) => void;
}) {
  const {
    state,
    findings,
    streamCustomerSubdomain,
    collabDoc,
    activeUnitId,
    setPhotoStudioUrl,
    setPhotoStudioKey,
    setPhotoStudioIndex,
    setPhotoStudioTotal,
    setPhotoStudioOpen,
  } = ctx;
  const dataSource = useFieldDataSource();
  const { urls } = dataSource, photoUrlVersion = usePhotoUrlVersion();
  /* Photo writes in flight, by kind + finding + photo. A crop or annotation save that repeats
   * while the first is still being queued or uploaded is dropped: the first one already applied
   * its optimistic edit, and a second bake of the same photo would race it. Released when the
   * save settles. A ref, set synchronously, so two calls in one frame send one. */
  const mediaSavesInFlight = useRef<Set<string>>(new Set());

  // Media Studio — gallery "Set as cover" opens an editor-level CoverCropper.
  const [galleryCropSource, setGalleryCropSource] = useState<{ key: string; url: string } | null>(null);
  // The cover crop saved during THIS editor session, which the cropper re-opens
  // on in preference to the row. `useInspectionState` freezes `inspection` at
  // mount and the route skips revalidation, so the row's `coverCrop` describes
  // the inspection as it was when the page loaded — recropping twice without a
  // reload would otherwise re-open on the frame the reader already replaced.
  const [sessionCoverCrop, setSessionCoverCrop] = useState<{ key: string; crop: StoredCoverCrop } | null>(null);
  // Plan 4 (Task 8) — per-photo crop. `photoCropTarget` opens the PhotoCropper for
  // an item/defect photo (cropping ALWAYS re-derives from the ORIGINAL key).
  const [photoCropTarget, setPhotoCropTarget] = useState<{
    itemId: string; photoIndex: number; sourceUrl: string; hasAnnotation: boolean; sectionId?: string;
  } | null>(null);
  // Plan 4 — re-crop warning modal: a crop that would discard an existing
  // annotation defers behind a confirm (no native window.confirm).
  const [recropWarn, setRecropWarn] = useState<{ run: () => void } | null>(null);

  /* Task 8 — unified MediaViewer for an item's photo strip. `viewer` holds the
   * item being viewed + the open index. Photos are mapped item-result → GalleryPhoto[]
   * on demand so the viewer reflects the live (optimistic) results map. A null
   * index means "closed". A dedicated fetcher persists reorder/detach/revert
   * (per-photo POSTs, separate from the shared save-all fetcher). */
  const [viewer, setViewer] = useState<{ itemId: string; index: number | null }>({ itemId: "", index: null });

  /* Plan 7 — resolve a Stream poster thumbnail URL for a video strip thumb. */
  const videoPosterUrl = useCallback(
    (streamUid: string, posterPct?: number): string | null => {
      if (!streamCustomerSubdomain) return null;
      // poster sec is unknown without duration here; the thumbnail endpoint accepts
      // a pct-derived time only when we know duration — fall back to time=0s, which
      // Stream maps to the configured thumbnailTimestampPct poster anyway.
      const sec = 0;
      void posterPct;
      return streamThumbUrl(streamCustomerSubdomain, streamUid, sec);
    },
    [streamCustomerSubdomain],
  );

  /* Plan 7 — PosterPicker target (a video entry being re-postered). */
  const [posterTarget, setPosterTarget] = useState<
    { streamUid: string; durationSec: number; posterPct: number } | null
  >(null);

  /* Task 8 — the report cover key (DB-16): a photo whose displayKey matches this
   * rings as the cover in the strip + carries the "Set cover" toggle in the viewer. */
  const coverKey = (state.inspection.coverPhotoId as string | null) ?? null;

  /* Task 8 — read an item's stored photos[] (item-level bucket) from the live
   * results map. Item photos are `{ key; croppedKey?; crop?; annotatedKey?; annotationsJson? }`. */
  type ItemCrop = { aspect: string; orientation: "landscape" | "portrait"; x: number; y: number; width: number; height: number };
  type ItemPhoto = { key: string; croppedKey?: string; crop?: ItemCrop; annotatedKey?: string; annotationsJson?: string; mediaType?: "photo" | "video"; provider?: "stream" | "r2"; streamUid?: string; mediaId?: string; posterPct?: number; durationSec?: number; pendingUpload?: boolean; pendingId?: string; pendingKind?: "photo" | "crop" | "annotate" };
  const getItemPhotos = useCallback(
    (itemId: string): ItemPhoto[] => {
      const r = findings.getResult(itemId, state.sectionIdForItem(itemId) ?? undefined);
      return ((r.photos as ItemPhoto[] | undefined) ?? []);
    },
    [findings, state.sectionIdForItem],
  );
  // The latest reader, for a save that awaits: photos may be removed or reordered while it waits.
  const photosNow = useRef(getItemPhotos);
  photosNow.current = getItemPhotos;

  /* #181 PR-G — local objectURL map for pending (offline) media. A pending photo
   * entry has no servable R2 key, so the strip/viewer renders the LOCAL blob from
   * the media-pending store. The effect loads a blob URL for every pending id in
   * the inspection's results and revokes URLs when their entry resolves/unmounts.
   * Pending entries with NO local blob (another device's upload) get no URL → the
   * gallery shows an "uploading…" placeholder instead of a broken image. */
  const [pendingUrls, setPendingUrls] = useState<Record<string, string>>({});

  // Collect every pending id currently present in the live results map. A change
  // to this set (a new offline capture, or one resolving) re-runs the loader.
  const pendingIds = useMemo(() => {
    const ids = new Set<string>();
    if (!collabDoc) return ids;
    for (const sec of state.sections) {
      for (const it of sec.items || []) {
        for (const p of getItemPhotos(it.id)) {
          if (p.pendingId) ids.add(p.pendingId);
        }
      }
    }
    return ids;
    // state.results drives getItemPhotos; depend on it so resolution re-runs.
  }, [collabDoc, state.sections, state.results, getItemPhotos]);

  useEffect(() => {
    let cancelled = false;
    const created: Record<string, string> = {};
    void (async () => {
      for (const id of pendingIds) {
        if (pendingUrls[id]) continue; // already have a URL for this id
        const url = await dataSource.media.store.objectUrl(id); // null: gone, or not a real Blob
        if (cancelled) { if (url) URL.revokeObjectURL(url); break; }
        if (url) created[id] = url;
      }
      if (!cancelled && Object.keys(created).length > 0) {
        setPendingUrls((prev) => ({ ...prev, ...created }));
      }
    })();

    // Revoke URLs for ids that are no longer pending (entry resolved).
    setPendingUrls((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [id, url] of Object.entries(prev)) {
        if (pendingIds.has(id)) {
          next[id] = url;
        } else {
          if (typeof URL !== "undefined") URL.revokeObjectURL(url);
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    return () => {
      cancelled = true;
    };
    // `pendingUrls` is read but intentionally excluded: including it would re-run
    // on every URL we add and loop. New ids arrive via `pendingIds`.
  }, [pendingIds, dataSource]);

  // Revoke all objectURLs on unmount. `pendingUrlsRef` mirrors the latest map so
  // the unmount cleanup revokes everything without re-subscribing per change.
  const pendingUrlsRef = useRef(pendingUrls);
  pendingUrlsRef.current = pendingUrls;
  useEffect(() => {
    return () => {
      if (typeof URL === "undefined") return;
      for (const url of Object.values(pendingUrlsRef.current)) URL.revokeObjectURL(url);
    };
  }, []);

  /* Task 8 — map an item's photos[] → GalleryPhoto[] for the unified MediaViewer.
   * displayKey (annotatedKey||key) drives the rendered image + URL; originalKey
   * keeps the un-annotated source; photoIndex addresses detach/revert; annotated
   * gates the Revert button. itemId is threaded so onAction knows the target. */
  const itemGalleryPhotos = useCallback(
    (itemId: string): GalleryPhoto[] =>
      getItemPhotos(itemId).map((p, i) => {
        // #181 PR-G — pending (offline) entry: render from the local blob URL when
        // this client owns it; otherwise (another device's upload) show a
        // placeholder. `pendingUpload` (brand-new photo) has no real key at all;
        // a pending crop/annotate keeps its base key but its NEW derivative is the
        // local blob, so prefer the local URL while pending.
        const localUrl = p.pendingId ? pendingUrls[p.pendingId] : undefined;
        if (p.pendingId) {
          const hasLocal = !!localUrl;
          // Brand-new pending photo with no base key → must use the local blob.
          // Pending crop/annotate → prefer local derivative preview, else the base.
          const baseKey = resolvePhotoDisplayKey(p);
          const url = hasLocal
            ? localUrl as string
            : baseKey
              ? urls.photo(state.inspection.id, baseKey)
              : "";
          return {
            key: baseKey || p.pendingId,
            url,
            label: "",
            itemId,
            photoIndex: i,
            annotated: !!p.annotatedKey || p.pendingKind === "annotate",
            originalKey: p.key,
            croppedKey: p.croppedKey,
            mediaType: p.mediaType,
            pending: true,
            // No local blob AND no base key to fall back on → placeholder, not a
            // broken image (another device captured this offline).
            pendingPlaceholder: !hasLocal && !baseKey,
          };
        }
        const dk = resolvePhotoDisplayKey(p);
        return {
          key: dk,
          url: urls.photo(state.inspection.id, dk),
          label: "",
          itemId,
          photoIndex: i,
          annotated: !!p.annotatedKey,
          originalKey: p.key,
          croppedKey: p.croppedKey,
          // Plan 7 — carry the media kind + provider so the viewer/strip can branch.
          mediaType: p.mediaType,
          provider: p.provider,
          streamUid: p.streamUid,
          mediaId: p.mediaId,
          posterPct: p.posterPct,
          durationSec: p.durationSec,
        };
      }),
    [getItemPhotos, state.inspection.id, pendingUrls, urls, photoUrlVersion],
  );

  /* Task 8 — open the viewer for an item at index i. */
  const onOpenPhoto = useCallback((itemId: string, index: number) => {
    setViewer({ itemId, index });
  }, []);

  /* Task 8 — optimistically apply a photos[] transform to the composite result
   * key. Phase U (Batch C2a): the composite key resolves under the ACTIVE unit
   * (`findingKey(activeUnitId, …)`). The bare-itemId mirror is written only in
   * the `_default` view (activeUnitId == null) — the legacy dual-write; under a
   * real unit the bare slot holds only one unit's entry, so mirroring would leak
   * this unit's photos into another unit that lacks a composite entry. At
   * activeUnitId == null the composite key === `_default:{sid}:{itemId}` and the
   * dual-write is preserved, so behavior is byte-identical to before. */
  const patchItemPhotos = useCallback(
    (itemId: string, next: (photos: ItemPhoto[]) => ItemPhoto[]) => {
      const sid = state.sectionIdForItem(itemId);
      // Phase U — under a real unit we can only key a properly-scoped composite.
      // If the section is unresolvable (defensive — should not happen for a real
      // template item) the bare `itemId` is a valid fallback ONLY in the common
      // scope; under a unit that shared slot would leak across units, so no-op.
      if (!sid && activeUnitId != null) return;
      const ck = sid ? findingKey(activeUnitId, sid, itemId) : itemId;
      state.setResults((prev) => {
        const bare = activeUnitId == null ? (prev[itemId] as Record<string, unknown>) : undefined;
        const existing = ((prev[ck] as Record<string, unknown>) || bare || {});
        const photos = next(((existing.photos as ItemPhoto[]) ?? []));
        const updated = { ...existing, photos };
        return activeUnitId == null
          ? { ...prev, [ck]: updated, [itemId]: updated }
          : { ...prev, [ck]: updated };
      });
      state.setDirty(true);
    },
    [state.sectionIdForItem, state.setResults, state.setDirty, activeUnitId],
  );

  /* #181 — the composite finding key the collab doc is keyed by. Phase U (Batch
   * C2a): resolve under the ACTIVE unit (`findingKey(activeUnitId, …)`), the
   * same scope patchItemPhotos writes. At activeUnitId == null this === the
   * legacy `_default:{sectionId}:{itemId}`. Returns null when the item has no
   * resolvable section (defensive — should not happen for a real template item). */
  const docFindingKey = useCallback(
    (itemId: string, sectionIdOverride?: string): string | null => {
      const sid = sectionIdOverride ?? state.sectionIdForItem(itemId);
      return sid ? findingKey(activeUnitId, sid, itemId) : null;
    },
    [state.sectionIdForItem, activeUnitId],
  );

  /* Task 8 — persist a reorder. CONTRACT: `order` is the ORIGINAL key order.
   * #181 — the Y.Doc is the authoritative writer of results.data: reorder the
   * doc photo array (the optimistic patch stays for instant feedback). */
  const onReorderPhotos = useCallback(
    (itemId: string, order: string[]) => {
      patchItemPhotos(itemId, (photos) => {
        const byKey = new Map(photos.map((p) => [p.key, p] as const));
        const reordered = order.map((k) => byKey.get(k)).filter((p): p is ItemPhoto => !!p);
        return reordered.length === photos.length ? reordered : photos;
      });
      if (collabDoc) {
        const fk = docFindingKey(itemId, state.currentSection?.id);
        if (fk) bindingReorderPhotos(collabDoc, fk, order);
      }
    },
    [patchItemPhotos, state.currentSection, collabDoc, docFindingKey],
  );

  /* Task 9 — bulk-detach photos by index. The doc is keyed by `key`, not index
   * (indices drift as elements are removed), so resolve each index→key from the
   * PRE-mutation snapshot and remove from the doc. */
  const onBulkDetachPhotos = useCallback(
    (itemId: string, indices: number[]) => {
      const sectionId = state.currentSection?.id;
      const fk = docFindingKey(itemId, sectionId);
      const snapshot = getItemPhotos(itemId);
      const keys = indices
        .map((i) => snapshot[i]?.key)
        .filter((k): k is string => !!k);
      patchItemPhotos(itemId, (photos) => photos.filter((_, i) => !indices.includes(i)));
      if (collabDoc && fk) for (const key of keys) bindingRemovePhoto(collabDoc, fk, key);
    },
    [state.currentSection, collabDoc, docFindingKey, getItemPhotos, patchItemPhotos],
  );

  /* Task 9b — the OTHER items photos can be moved to: every item across the
   * inspection except the one currently being edited, each carrying its own
   * section id so the move resolves the right composite finding key on arrival. */
  const moveTargets = useMemo(
    () =>
      state.sections.flatMap((sec) =>
        (sec.items || []).map((it) => ({
          itemId: it.id,
          label: `${sec.title} › ${it.label || it.name || it.id}`,
          sectionId: sec.id,
        })),
      ),
    [state.sections],
  );

  /* Task 9b — bulk-move photos by index to a target item. The doc is keyed by
   * `key`, not index, so resolve index→key from the PRE-mutation snapshot and
   * move each in the doc. The source section is the current one. */
  const onBulkMovePhotos = useCallback(
    (fromItemId: string, indices: number[], to: { itemId: string; sectionId?: string }) => {
      const fromSectionId = state.currentSection?.id;
      const fromFk = docFindingKey(fromItemId, fromSectionId);
      const toFk = docFindingKey(to.itemId, to.sectionId);
      const snapshot = getItemPhotos(fromItemId);
      const keys = indices
        .map((i) => snapshot[i]?.key)
        .filter((k): k is string => !!k);
      patchItemPhotos(fromItemId, (photos) => photos.filter((_, i) => !indices.includes(i)));
      if (collabDoc && fromFk && toFk) for (const key of keys) bindingMovePhoto(collabDoc, fromFk, toFk, key);
    },
    [state.currentSection, collabDoc, docFindingKey, getItemPhotos, patchItemPhotos],
  );

  /* Task 8 — route a viewer per-photo action to the right mutation. */
  const onViewerAction = useCallback(
    (action: MediaAction, photo: GalleryPhoto) => {
      const itemId = photo.itemId;
      const idx = photo.photoIndex;
      const sectionId = state.currentSection?.id;
      if (!itemId || idx == null) return;
      // Plan 7 — video branch. A video entry exposes only poster · cover · caption
      // · delete (the MediaViewer toolbar enforces this). Poster opens the picker;
      // delete removes the Stream video + detaches the entry; cover/caption fall
      // through to the shared handlers (cover stores the poster image reference).
      if (photo.mediaType === "video") {
        if (action === "poster" && photo.streamUid) {
          setPosterTarget({
            streamUid: photo.streamUid,
            durationSec: photo.durationSec ?? 0,
            posterPct: photo.posterPct ?? 0,
          });
          return;
        }
        if (action === "delete") {
          const { videoRef, docKey, idField, isIt } = videoEntryIdentity(photo, idx);
          const removeEntry = () => {
            patchItemPhotos(itemId, (photos) => photos.filter((p, i) => !isIt(p, i)));
            const fk = collabDoc ? docFindingKey(itemId, sectionId) : null;
            if (collabDoc && fk && docKey) bindingRemovePhoto(collabDoc, fk, docKey);
            else if (collabDoc && fk && videoRef) bindingRemoveMediaBy(collabDoc, fk, idField, videoRef);
          };
          if (!videoRef) removeEntry();
          else {
            void freeVideoMedia(state.inspection.id, videoRef).then((freed) => {
              if (freed) removeEntry();
              else if (freed === false) dataSource.notify(m.editor_video_delete_failed(), "error", { durationMs: 6000 });
            });
          }
          return;
        }
        // cover / caption fall through to the photo handlers below (they address by
        // itemId + photoIndex, which is valid for video entries too).
      }
      if (action === "cover") {
        // Reuse the existing CoverCropper flow: crop-then-set on the displayed key.
        setGalleryCropSource({ key: photo.key, url: photo.url });
        return;
      }
      if (action === "annotate") {
        // Plan 4 sequential layering: annotate ON TOP of the crop. The annotate
        // base is croppedKey || originalKey — NEVER annotatedKey (that would
        // double-bake the existing annotation).
        const annotateBaseKey = photo.croppedKey || photo.originalKey || photo.key;
        setPhotoStudioUrl(urls.photo(state.inspection.id, annotateBaseKey, "original"));
        setPhotoStudioKey(photo.key);
        setPhotoStudioIndex(idx);
        setPhotoStudioTotal(0);
        setPhotoStudioOpen(true);
        return;
      }
      if (action === "crop") {
        // Plan 4: crop ALWAYS re-derives from the ORIGINAL photo (never the
        // cropped/annotated derivative). Open the PhotoCropper; the bake POSTs to
        // the new crop endpoint (or enqueues offline — Task 9). A re-crop that
        // would discard an existing annotation warns first.
        const originalKey = photo.originalKey || photo.key;
        setPhotoCropTarget({
          itemId,
          photoIndex: idx,
          sourceUrl: urls.photo(state.inspection.id, originalKey, "original"),
          hasAnnotation: !!photo.annotated,
          sectionId,
        });
        return;
      }
      if (action === "revert") {
        patchItemPhotos(itemId, (photos) => photos.map((p, i) => (i === idx ? { key: p.key } : p)));
        if (collabDoc) {
          const fk = docFindingKey(itemId, sectionId);
          const docKey = photo.originalKey || photo.key;
          if (fk && docKey) bindingRevertPhoto(collabDoc, fk, docKey);
        }
        return;
      }
      if (action === "delete") {
        patchItemPhotos(itemId, (photos) => photos.filter((_, i) => i !== idx));
        if (collabDoc) {
          const fk = docFindingKey(itemId, sectionId);
          const docKey = photo.originalKey || photo.key;
          if (fk && docKey) bindingRemovePhoto(collabDoc, fk, docKey);
        }
        return;
      }
      // rotate / caption — routed here but not yet implemented (not Plan 4).
      // TODO rotate/caption on item photos.
    },
    [patchItemPhotos, state.inspection.id, state.currentSection, collabDoc, docFindingKey, dataSource, urls],
  );

  /* Plan 4 (Task 8/9) — persist a baked crop for the targeted photo. When online,
   * POST multipart to the new crop endpoint; when offline, enqueue for replay
   * (Task 9). Either way, optimistically apply clearAnnotationOnRecrop locally so
   * the strip immediately reflects the new crop with any annotation cleared.
   * `onChecked` runs once the image has been checked: the caller closes its dialog only when told it may. */
  const performPhotoCropSave = useCallback(
    (target: { itemId: string; photoIndex: number; sectionId?: string }, blob: Blob, crop: PhotoCrop, onChecked?: OnChecked) => {
      const { itemId, photoIndex, sectionId } = target;
      const cropTransform = { aspect: crop.aspect, orientation: crop.orientation, ...crop.pixels };

      // The original key, read BEFORE any mutation: the doc write and the offline enqueue address by key.
      const originalKey = getItemPhotos(itemId)[photoIndex]?.key;
      const fk = docFindingKey(itemId, sectionId);

      // A repeat in flight, an unaddressable photo or no live document: dropped before anything, with a message.
      const saveKey = `crop|${fk ?? itemId}|${originalKey ?? photoIndex}`;
      if (dropMediaSave(dataSource, mediaSavesInFlight.current, saveKey, { fk, originalKey, doc: collabDoc }, onChecked)) return;
      if (!fk || !originalKey || !collabDoc) return; // narrowing only: the guard above already said why

      const rec: PendingMediaRecord = {
        pendingId: crypto.randomUUID(),
        inspectionId: String(state.inspection.id),
        kind: "crop",
        blob,
        meta: { findingKey: fk, itemId, photoIndex, photoKey: originalKey, crop: cropTransform, ...(sectionId ? { sectionId } : {}) },
        createdAt: Date.now(),
      };

      // The image is checked first (guardedSave holds the photo meanwhile): a crop the server would refuse is neither
      // queued, sent nor shown, and the person is told. Then the optimistic local apply for instant feedback (the doc
      // drives the real UI once the bake returns / drains + we write it back).
      guardedSave(dataSource, mediaSavesInFlight.current, saveKey, async () => {
        // Refused: the dialog stays open with the person's crop, so they can adjust it or cancel.
        if (await refuseInadmissibleImage(dataSource, blob, onChecked)) return;
        // The check read the whole blob; find the photo again BY KEY. Gone (removed meanwhile): nothing is written.
        const current = photosNow.current(itemId).find((p) => p?.key === originalKey);
        if (!current) return;
        patchItemPhotos(itemId, (photos) => {
          const at = photos.findIndex((p) => p?.key === originalKey);
          return photos.map((p, i) => (i === at ? clearAnnotationOnRecrop(p, p.croppedKey ?? p.key, cropTransform) : p));
        });

        // #181 PR-G — offline: persist the baked crop locally + mark the doc photo
        // pending-crop (KEEP the base key so the report still serves the original).
        // The drain (on reconnect) uploads the derivative and swaps in croppedKey.
        if (!dataSource.isOnline()) {
          await enqueueMedia(dataSource.media.store, rec);
          bindingMarkPhotoPending(collabDoc, fk, originalKey, rec.pendingId, "crop", { crop: cropTransform });
          return;
        }

        // Online: the data source's uploader bakes the crop. A save that returns no key changes
        // nothing further: no toast, no revalidate — the doc drives the UI.
        const res = await dataSource.media.uploader(String(state.inspection.id), collabDoc).upload(rec);
        if (res.ok) bindingSetPhotoCrop(collabDoc, fk, originalKey, res.key, cropTransform, current as PhotoEntry);
      });
    },
    [patchItemPhotos, state.inspection.id, collabDoc, docFindingKey, getItemPhotos, dataSource],
  );

  /* #181 — collab-aware annotation save. Returns true when it HANDLED the save (collab is ON); the caller then skips
   * its legacy fetcher path, and false otherwise. The server derives the annotated PNG; the returned annotatedKey is
   * mirrored into the doc (additive merge, annotation never clears the crop). Offline it is queued, as for a crop.
   * `onChecked` runs once the image has been checked: the caller closes its studio only when told it may. */
  const performPhotoAnnotationSave = useCallback(
    (target: { itemId: string; photoIndex: number; sectionId?: string }, blob: Blob, nodesJson: string, onChecked?: OnChecked): boolean => {
      if (!collabDoc) return false;
      const { itemId, photoIndex, sectionId } = target;

      // The doc is keyed by the photo's ORIGINAL key; resolve from the snapshot.
      const originalKey = getItemPhotos(itemId)[photoIndex]?.key;
      const fk = docFindingKey(itemId, sectionId);

      // A repeat of a save still in flight, or a photo that cannot be addressed, is dropped with a message (and counts as handled).
      const saveKey = `annotate|${fk ?? itemId}|${originalKey ?? photoIndex}`;
      if (dropMediaSave(dataSource, mediaSavesInFlight.current, saveKey, { fk, originalKey, doc: collabDoc }, onChecked)) return true;
      if (!fk || !originalKey) return true; // narrowing only: the guard above already said why
      const rec: PendingMediaRecord = {
        pendingId: crypto.randomUUID(),
        inspectionId: String(state.inspection.id),
        kind: "annotate",
        blob,
        meta: { findingKey: fk, itemId, photoIndex, photoKey: originalKey, nodesJson, ...(sectionId ? { sectionId } : {}) },
        createdAt: Date.now(),
      };

      // The image is checked first (guardedSave holds the photo meanwhile): an annotation the server would refuse is
      // neither queued nor sent, and the person is told. The editor already tried a smaller export; see PhotoAnnotator.
      guardedSave(dataSource, mediaSavesInFlight.current, saveKey, async () => {
        // Refused: the dialog stays open with the person's strokes, so they can adjust them or cancel.
        if (await refuseInadmissibleImage(dataSource, blob, onChecked)) return;
        if (!photosNow.current(itemId).some((p) => p?.key === originalKey)) return;

        // #181 PR-G — offline: persist the baked annotation PNG locally + mark the
        // doc photo pending-annotate (KEEP base/cropped key — annotation layers on
        // top; the report serves the base until the derivative drains).
        if (!dataSource.isOnline()) {
          await enqueueMedia(dataSource.media.store, rec);
          bindingMarkPhotoPending(collabDoc, fk, originalKey, rec.pendingId, "annotate", { annotationsJson: nodesJson });
          return;
        }

        // Online: the data source's uploader bakes the annotation; no key back changes nothing
        // further. No revalidate — the doc drives the UI under collab.
        const res = await dataSource.media.uploader(String(state.inspection.id), collabDoc).upload(rec);
        if (res.ok) bindingSetPhotoAnnotation(collabDoc, fk, originalKey, res.key, nodesJson);
      });
      return true;
    },
    [collabDoc, docFindingKey, getItemPhotos, state.inspection.id, dataSource],
  );

  /* #181 PR-G — resolve a pending entry's local blob URL for the strip/viewer.
   * Returns undefined when this client does not own the blob (another device). */
  const pendingPhotoUrl = useCallback(
    (pendingId: string): string | undefined => pendingUrls[pendingId],
    [pendingUrls],
  );

  return {
    viewer,
    setViewer,
    pendingPhotoUrl,
    photoCropTarget,
    setPhotoCropTarget,
    recropWarn,
    setRecropWarn,
    galleryCropSource,
    setGalleryCropSource,
    sessionCoverCrop,
    setSessionCoverCrop,
    posterTarget,
    setPosterTarget,
    coverKey,
    videoPosterUrl,
    getItemPhotos,
    itemGalleryPhotos,
    onOpenPhoto,
    patchItemPhotos,
    onReorderPhotos,
    onBulkDetachPhotos,
    moveTargets,
    onBulkMovePhotos,
    onViewerAction,
    performPhotoCropSave,
    performPhotoAnnotationSave,
  };
}
