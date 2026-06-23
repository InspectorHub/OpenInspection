import { useState, useCallback, useMemo } from "react";
import type * as Y from "yjs";
import { pushToast } from "~/hooks/useToast";
import { resolvePhotoDisplayKey, clearAnnotationOnRecrop } from "~/components/media-studio/photo-display-key";
import { type MediaAction } from "~/components/media-studio/MediaViewer";
import { streamThumbUrl } from "~/components/media-studio/PosterPicker";
import type { GalleryPhoto } from "~/lib/inspection-media";
import { fKey } from "~/hooks/useInspection";
import { type PhotoCrop } from "~/components/media-studio/PhotoCropper";
import type { useInspectionState } from "~/hooks/useInspection";
import type { useFindings } from "~/hooks/useFindings";
import {
  reorderPhotos as bindingReorderPhotos,
  movePhoto as bindingMovePhoto,
  removePhoto as bindingRemovePhoto,
  revertPhoto as bindingRevertPhoto,
  setPhotoCrop as bindingSetPhotoCrop,
  setPhotoAnnotation as bindingSetPhotoAnnotation,
} from "~/lib/collab/results-binding";
import type { PhotoEntry } from "../../server/lib/collab/results-doc.types";

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
    setPhotoStudioUrl,
    setPhotoStudioKey,
    setPhotoStudioIndex,
    setPhotoStudioTotal,
    setPhotoStudioOpen,
  } = ctx;

  // Media Studio — gallery "Set as cover" opens an editor-level CoverCropper.
  const [galleryCropSource, setGalleryCropSource] = useState<{ key: string; url: string } | null>(null);
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
  type ItemPhoto = { key: string; croppedKey?: string; crop?: ItemCrop; annotatedKey?: string; annotationsJson?: string; mediaType?: "photo" | "video"; provider?: "stream" | "r2"; streamUid?: string; mediaId?: string; posterPct?: number; durationSec?: number };
  const getItemPhotos = useCallback(
    (itemId: string): ItemPhoto[] => {
      const r = findings.getResult(itemId, state.sectionIdForItem(itemId) ?? undefined);
      return ((r.photos as ItemPhoto[] | undefined) ?? []);
    },
    [findings, state.sectionIdForItem],
  );

  /* Task 8 — map an item's photos[] → GalleryPhoto[] for the unified MediaViewer.
   * displayKey (annotatedKey||key) drives the rendered image + URL; originalKey
   * keeps the un-annotated source; photoIndex addresses detach/revert; annotated
   * gates the Revert button. itemId is threaded so onAction knows the target. */
  const itemGalleryPhotos = useCallback(
    (itemId: string): GalleryPhoto[] =>
      getItemPhotos(itemId).map((p, i) => {
        const dk = resolvePhotoDisplayKey(p);
        return {
          key: dk,
          url: `/api/inspections/${state.inspection.id}/photo?key=${encodeURIComponent(dk)}`,
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
    [getItemPhotos, state.inspection.id],
  );

  /* Task 8 — open the viewer for an item at index i. */
  const onOpenPhoto = useCallback((itemId: string, index: number) => {
    setViewer({ itemId, index });
  }, []);

  /* Task 8 — optimistically apply a photos[] transform to BOTH result keys
   * (composite + bare itemId), mirroring useFindings' dual-write. */
  const patchItemPhotos = useCallback(
    (itemId: string, next: (photos: ItemPhoto[]) => ItemPhoto[]) => {
      const sid = state.sectionIdForItem(itemId);
      const ck = sid ? fKey(sid, itemId) : itemId;
      state.setResults((prev) => {
        const existing = ((prev[ck] as Record<string, unknown>) || (prev[itemId] as Record<string, unknown>) || {});
        const photos = next(((existing.photos as ItemPhoto[]) ?? []));
        const updated = { ...existing, photos };
        return { ...prev, [ck]: updated, [itemId]: updated };
      });
      state.setDirty(true);
    },
    [state.sectionIdForItem, state.setResults, state.setDirty],
  );

  /* #181 — the composite finding key the collab doc is keyed by. The doc seeds
   * keys as `_default:{sectionId}:{itemId}` (fKey); resolve the section the same
   * way patchItemPhotos does. Returns null when the item has no resolvable
   * section (defensive — should not happen for a real template item). */
  const docFindingKey = useCallback(
    (itemId: string, sectionIdOverride?: string): string | null => {
      const sid = sectionIdOverride ?? state.sectionIdForItem(itemId);
      return sid ? fKey(sid, itemId) : null;
    },
    [state.sectionIdForItem],
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
          patchItemPhotos(itemId, (photos) => photos.filter((_, i) => i !== idx));
          // Remove the doc entry (the Y.Doc owns results.data). Separately, free
          // the Stream/R2 backing object via the binary media DELETE — that is a
          // network op, not the retired CAS results write. DELETE
          // /{id}/media/video/{ref} accepts a Stream UID or an R2 mediaId and
          // resolves the backend per provider.
          const videoRef = photo.provider === "r2" ? photo.mediaId : photo.streamUid;
          const docKey = photo.originalKey || photo.key;
          if (collabDoc) {
            const fk = docFindingKey(itemId, sectionId);
            if (fk && docKey) bindingRemovePhoto(collabDoc, fk, docKey);
          }
          if (videoRef) {
            void fetch(`/api/inspections/${state.inspection.id}/media/video/${encodeURIComponent(videoRef)}`, {
              method: "DELETE",
              credentials: "include",
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
        setPhotoStudioUrl(`/api/inspections/${state.inspection.id}/photo?key=${encodeURIComponent(annotateBaseKey)}`);
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
          sourceUrl: `/api/inspections/${state.inspection.id}/photo?key=${encodeURIComponent(originalKey)}`,
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
    [patchItemPhotos, state.inspection.id, state.currentSection, collabDoc, docFindingKey],
  );

  /* Plan 4 (Task 8/9) — persist a baked crop for the targeted photo. When online,
   * POST multipart to the new crop endpoint; when offline, enqueue for replay
   * (Task 9). Either way, optimistically apply clearAnnotationOnRecrop locally so
   * the strip immediately reflects the new crop with any annotation cleared. */
  const performPhotoCropSave = useCallback(
    (target: { itemId: string; photoIndex: number; sectionId?: string }, blob: Blob, crop: PhotoCrop) => {
      const { itemId, photoIndex, sectionId } = target;
      const cropTransform = { aspect: crop.aspect, orientation: crop.orientation, ...crop.pixels };

      // #181 — the Y.Doc owns results.data. Image baking ALWAYS needs the
      // network (the server derives + stores the cropped R2 object); offline
      // refuses with a toast rather than mutating anything.
      const nav = typeof navigator !== "undefined" ? navigator : undefined;
      if (nav && nav.onLine === false) {
        pushToast({ message: "Crop & annotate need a connection", durationMs: 3000 });
        return;
      }

      // Optimistic local apply for instant feedback (the doc drives the real UI
      // once the bake returns + we write it back).
      patchItemPhotos(itemId, (photos) =>
        photos.map((p, i) =>
          i === photoIndex
            ? clearAnnotationOnRecrop(p, p.croppedKey ?? p.key, cropTransform)
            : p,
        ),
      );
      // Snapshot the photo's CURRENT entry + original key BEFORE the bake so the
      // doc write preserves non-annotation fields and addresses by key.
      const current = getItemPhotos(itemId)[photoIndex];
      const originalKey = current?.key;
      const fk = docFindingKey(itemId, sectionId);
      const fd = new FormData();
      fd.append("image", new File([blob], "cropped.jpg", { type: "image/jpeg" }));
      fd.append("crop", JSON.stringify(cropTransform));
      if (sectionId) fd.append("sectionId", sectionId);
      void (async () => {
        const res = await fetch(
          `/api/inspections/${state.inspection.id}/items/${itemId}/photos/${photoIndex}/crop`,
          { method: "POST", credentials: "include", body: fd },
        );
        const body = (await res.json().catch(() => null)) as { data?: { croppedKey?: string } } | null;
        const croppedKey = body?.data?.croppedKey;
        if (collabDoc && fk && originalKey && croppedKey) {
          bindingSetPhotoCrop(
            collabDoc,
            fk,
            originalKey,
            croppedKey,
            cropTransform,
            current as PhotoEntry,
          );
        }
        // No revalidate — the doc drives the UI.
      })();
    },
    [patchItemPhotos, state.inspection.id, collabDoc, docFindingKey, getItemPhotos],
  );

  /* #181 — collab-aware annotation save. Returns true when it HANDLED the save
   * (collab is ON); the caller then skips its legacy fetcher/offline path. When
   * collab is OFF returns false so the caller keeps byte-identical behavior.
   *
   * Annotation baking ALWAYS needs the network (the server derives + stores the
   * annotated PNG); offline under collab refuses with a toast rather than using
   * the legacy offline queue (which replays via REST with no doc → loss). On
   * success, POST the bake, read the annotatedKey, and mirror it into the doc
   * (additive merge — annotation never clears the crop). No revalidate. */
  const performPhotoAnnotationSave = useCallback(
    (target: { itemId: string; photoIndex: number; sectionId?: string }, blob: Blob, nodesJson: string): boolean => {
      if (!collabDoc) return false;
      const { itemId, photoIndex, sectionId } = target;

      const nav = typeof navigator !== "undefined" ? navigator : undefined;
      if (nav && nav.onLine === false) {
        pushToast({ message: "Crop & annotate need a connection", durationMs: 3000 });
        return true;
      }

      // The doc is keyed by the photo's ORIGINAL key; resolve from the snapshot.
      const originalKey = getItemPhotos(itemId)[photoIndex]?.key;
      const fk = docFindingKey(itemId, sectionId);

      const fd = new FormData();
      fd.append("nodes", nodesJson);
      if (sectionId) fd.append("sectionId", sectionId);
      fd.append("image", new File([blob], "annotated.png", { type: "image/png" }));
      void (async () => {
        const res = await fetch(
          `/api/inspections/${state.inspection.id}/items/${itemId}/photos/${photoIndex}/annotation`,
          { method: "POST", credentials: "include", body: fd },
        );
        const body = (await res.json().catch(() => null)) as { data?: { annotatedKey?: string } } | null;
        const annotatedKey = body?.data?.annotatedKey;
        if (fk && originalKey && annotatedKey) {
          bindingSetPhotoAnnotation(collabDoc, fk, originalKey, annotatedKey, nodesJson);
        }
        // No revalidate — the doc drives the UI under collab.
      })();
      return true;
    },
    [collabDoc, docFindingKey, getItemPhotos, state.inspection.id],
  );

  return {
    viewer,
    setViewer,
    photoCropTarget,
    setPhotoCropTarget,
    recropWarn,
    setRecropWarn,
    galleryCropSource,
    setGalleryCropSource,
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
