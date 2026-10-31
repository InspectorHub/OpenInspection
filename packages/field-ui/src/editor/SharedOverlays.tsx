import type { ComponentProps } from "react";
import { VersionHistoryPanel } from "../components/collab/VersionHistoryPanel";
import { AddGroupInstanceHost } from "../components/statutory/AddGroupInstanceHost";
import { BurstCamera } from "../components/editor/BurstCamera";
import { PhotoAnnotator } from "../components/media-studio/PhotoAnnotator";
import { CoverCropper, coverCropFor } from "../components/media-studio/CoverCropper";
import { PhotoCropper } from "../components/media-studio/PhotoCropper";
import { MediaViewer, ALL_MEDIA_ACTIONS } from "../components/media-studio/MediaViewer";
import { useReadOnly } from "../read-only";
import { PosterPicker } from "../components/media-studio/PosterPicker";
import { fullResUrl } from "../components/media-studio/cropImage";
import { RecropWarningModal } from "../components/editor/RecropWarningModal";
import { StructureDeleteModal } from "../components/editor/StructureDeleteModal";
import { AddSectionPromptModal } from "../components/editor/AddSectionPromptModal";
import { AddItemTypeModal } from "../components/editor/AddItemTypeModal";
import { SaveTemplateModal } from "../components/editor/SaveTemplateModal";
import { CommentLibraryDrawer } from "../components/editor/CommentLibraryDrawer";
import { SectionPickerModal } from "../components/editor/SectionPickerModal";
import { TagPickerModal } from "../components/editor/TagPickerModal";
import { UnitsManager } from "../components/editor/UnitsManager";
import { CostItemsHost } from "../components/editor/CostItemsHost";
import type { UnitScopeRow } from "../components/editor/BreadcrumbDropdown";
import type { useInspectionState } from "../hooks/useInspection";
import type { useStructureEdit } from "../hooks/useStructureEdit";
import type { useReportCoverWrites } from "../hooks/useReportCoverWrites";
import type { useAddStatutoryInstance } from "../hooks/useAddStatutoryInstance";
import type { useStatutoryGroups } from "../hooks/useStatutoryGroups";
import type { useCannedComments } from "../hooks/useCannedComments";
import type { usePhotoOps } from "../hooks/usePhotoOps";
import type { EditorCapabilities } from "../hooks/useEditorCapabilities";
import type { ResultsProjection } from "../shared/results-doc.types";
import { m } from "../i18n";
import { usePhotoDialogSaves } from "../hooks/usePhotoDialogSaves";

type PhotoOps = ReturnType<typeof usePhotoOps>;

export interface SharedOverlaysProps {
  state: ReturnType<typeof useInspectionState>;
  caps: EditorCapabilities;
  structure: ReturnType<typeof useStructureEdit>;
  coverWrites: ReturnType<typeof useReportCoverWrites>;
  comments: ReturnType<typeof useCannedComments>;
  statutoryInstance: ReturnType<typeof useAddStatutoryInstance>;
  statutoryGroups: ReturnType<typeof useStatutoryGroups>;
  /** The live collaboration document; null until the connection is up. */
  collabDoc: ComponentProps<typeof VersionHistoryPanel>["doc"];
  inspectionId: string;
  /** The phone layout: the comment library opens as a bottom sheet instead of the right-hand drawer. */
  phone: boolean;
  streamCustomerSubdomain: string | null;
  /** Asks the host to reload the editor data (after a version restore). */
  onReload: () => void;

  /* Burst camera */
  handleBurstCommit: ComponentProps<typeof BurstCamera>["onCommit"];

  /* Photo studio (annotator) */
  studio: {
    open: boolean;
    url: string | null;
    key: string | null;
    index: number;
    total: number;
    setOpen: (open: boolean) => void;
  };

  /* Photo operations */
  photoOps: Pick<
    PhotoOps,
    | "viewer" | "setViewer" | "itemGalleryPhotos" | "onViewerAction"
    | "posterTarget" | "setPosterTarget"
    | "photoCropTarget" | "setPhotoCropTarget" | "recropWarn" | "setRecropWarn"
    | "galleryCropSource" | "setGalleryCropSource" | "sessionCoverCrop" | "setSessionCoverCrop"
    | "performPhotoCropSave" | "performPhotoAnnotationSave"
  >;

  /* Statutory group instances */
  addingToGroup: string | null;
  setAddingToGroup: (groupId: string | null) => void;

  /* Version history, library, pickers */
  versionHistoryOpen: boolean;
  setVersionHistoryOpen: (open: boolean) => void;
  serverComments: ComponentProps<typeof CommentLibraryDrawer>["serverComments"];
  onInsert: ComponentProps<typeof CommentLibraryDrawer>["onInsert"];
  tagPickerOpen: boolean;
  setTagPickerOpen: (open: boolean) => void;
  presetTags: ComponentProps<typeof TagPickerModal>["presetTags"];
  toggleTag: ComponentProps<typeof TagPickerModal>["onToggle"];

  /* Commercial surfaces */
  showUnitsSurface: boolean;
  unitsManagerOpen: boolean;
  setUnitsManagerOpen: (open: boolean) => void;
  units: UnitScopeRow[];
  unitInspectionMode: ComponentProps<typeof UnitsManager>["mode"];
  costItemsOpen: boolean;
  setCostItemsOpen: (open: boolean) => void;
}

/**
 * Every overlay the editor can open that is not one of the finish dialogs, mounted ONCE per layout tree.
 *
 * These lived inline in the desktop tree only, so on a phone a photo could not be opened, annotated or
 * cropped and the library, pickers and structure dialogs were unreachable. One element rendered by both
 * trees means the two cannot drift again. Each overlay keeps the gate it had: the comment library needs the
 * library capability, the units and cost surfaces need a commercial inspection.
 *
 * Not here on purpose: the add-media chooser and video capture (`addMediaOverlaysEl`), the finish dialogs
 * (`finishActionsEl`) and the unsaved-changes guard are already mounted by both trees, and speed mode and the
 * shortcut sheet are keyboard-driven and have no touch entry point.
 */
export function SharedOverlays({
  state, caps, structure, coverWrites, comments, statutoryInstance, statutoryGroups, collabDoc, inspectionId,
  phone, streamCustomerSubdomain, onReload, handleBurstCommit, studio, photoOps, addingToGroup, setAddingToGroup,
  versionHistoryOpen, setVersionHistoryOpen, serverComments, onInsert, tagPickerOpen, setTagPickerOpen,
  presetTags, toggleTag, showUnitsSurface, unitsManagerOpen, setUnitsManagerOpen, units, unitInspectionMode,
  costItemsOpen, setCostItemsOpen,
}: SharedOverlaysProps) {
  const {
    viewer, setViewer, itemGalleryPhotos, onViewerAction, posterTarget, setPosterTarget, photoCropTarget,
    setPhotoCropTarget, recropWarn, setRecropWarn, galleryCropSource, setGalleryCropSource, sessionCoverCrop,
    setSessionCoverCrop, performPhotoCropSave, performPhotoAnnotationSave,
  } = photoOps;
  const readOnly = useReadOnly();
  const { saveCrop, cancelCrop, saveAnnotation, closeStudio } = usePhotoDialogSaves({
    performPhotoCropSave, performPhotoAnnotationSave, setPhotoCropTarget, setRecropWarn, setStudioOpen: studio.setOpen, annotateChecked: coverWrites.annotateChecked, photoCropTarget, studioOpen: studio.open,
  });
  return (
    <>
 {/* Burst camera overlay */}
 <BurstCamera
 open={state.burstCameraOpen}
 onClose={() => {
 state.setBurstCameraOpen(false);
 state.setBurstCameraItemId(null);
 }}
 onCommit={handleBurstCommit}
 />

 {/* Photo studio overlay */}
 <PhotoAnnotator
 open={studio.open}
 photoUrl={studio.url}
 photoIndex={studio.index}
 totalPhotos={studio.total}
 sectionName={state.currentSection?.title || state.currentSection?.name || ""}
 initialAnnotationsJson={null}
 isCover={!!studio.key && (state.inspection.coverPhotoId as string | null) === studio.key}
 onSetCover={studio.key ? () => {
  const isCover = (state.inspection.coverPhotoId as string | null) === studio.key;
  coverWrites.setCover(isCover ? "" : (studio.key ?? ""));
 } : undefined}
 onSave={({ blob, nodesJson }) => {
  const itemId = state.activeItemId;
  if (!itemId || studio.index == null) { closeStudio(); return; }
  // #181 — the Y.Doc owns results.data: the annotation PNG is baked to R2 and its annotatedKey mirrored into the doc.
  // The studio closes once the image is admitted; a refused image leaves it open with the strokes in it.
  saveAnnotation({ itemId, photoIndex: studio.index, sectionId: state.currentSection?.id }, blob, nodesJson);
 }}
 onClose={closeStudio}
 />

 {/* Task 8 — unified MediaViewer for an item's photo strip (tap a thumbnail
  * to open; the bottom toolbar routes cover/annotate/revert/delete to the
  * per-photo endpoints; crop opens the PhotoCropper, rotate/caption are no-ops). */}
 <MediaViewer
 photos={viewer.index !== null ? itemGalleryPhotos(viewer.itemId) : []}
 index={viewer.index}
 onClose={() => setViewer((v) => ({ ...v, index: null }))}
 onAction={onViewerAction}
 hideActions={readOnly ? ALL_MEDIA_ACTIONS : caps.video ? undefined : ["poster"]}
 streamCustomerSubdomain={streamCustomerSubdomain}
 inspectionId={inspectionId}
 />

 {/* Plan 7 — poster-frame picker for a video entry (opened by the "Poster
  * frame" toolbar action). Fails closed when the Stream subdomain is absent. */}
 {posterTarget && (
 <PosterPicker
  inspectionId={inspectionId}
  streamUid={posterTarget.streamUid}
  durationSec={posterTarget.durationSec}
  posterPct={posterTarget.posterPct}
  streamCustomerSubdomain={streamCustomerSubdomain}
  onClose={() => setPosterTarget(null)}
 />
 )}

 {/* Plan 4 (Task 8) — per-photo crop overlay. Cropping ALWAYS re-derives from
  * the ORIGINAL key. A re-crop that would discard an existing annotation warns
  * first (no native window.confirm). */}
 {photoCropTarget && (
 <PhotoCropper
  sourceUrl={fullResUrl(photoCropTarget.sourceUrl)}
  allowFree
  title={m.editor_route_crop_photo()}
  saveLabel={m.editor_route_save_crop()}
  onCancel={cancelCrop}
  onSave={(blob, crop) => saveCrop(photoCropTarget, blob, crop)}
 />
 )}

 {/* Plan 4 — re-crop warning modal (annotation will be discarded). */}
 <RecropWarningModal
 open={Boolean(recropWarn)}
 onCancel={() => setRecropWarn(null)}
 onConfirm={() => { const r = recropWarn?.run; setRecropWarn(null); r?.(); }}
 />

 {/* D8 — structural delete confirmation modal (section OR item; NEVER window.confirm). */}
 <StructureDeleteModal
  open={Boolean(structure.deletePending)}
  title={structure.deletePending?.title ?? ""}
  noun={structure.deletePending?.kind ?? "section"}
  impact={structure.deletePending?.impact ?? { items: 0, ratings: 0, notes: 0, photos: 0 }}
  onCancel={structure.cancelDelete}
  onConfirm={structure.confirmDelete}
 />

 {/* D8 — "Add section" title prompt. */}
 <AddSectionPromptModal
  open={structure.addSectionPromptOpen}
  value={structure.addSectionTitle}
  onChange={structure.setAddSectionTitle}
  onConfirm={structure.submitAddSection}
  onCancel={structure.closeAddSectionPrompt}
 />

 <AddGroupInstanceHost
   groups={statutoryGroups}
   groupId={addingToGroup}
   saving={statutoryInstance.busy}
   onClose={() => setAddingToGroup(null)}
   onSave={(group, fields) => {
     statutoryInstance.add(group.id, group.capacity, fields);
     setAddingToGroup(null);
   }}
 />

 {/* D8 — "Add item" type-picker. */}
 <AddItemTypeModal
  open={Boolean(structure.addItemPending)}
  onConfirm={structure.submitAddItem}
  onCancel={structure.closeAddItemPrompt}
 />

 {/* D8 — save structure to template / as new template. */}
 <SaveTemplateModal
  mode={structure.saveTemplatePending?.mode ?? null}
  name={structure.saveTemplateName}
  onChangeName={structure.setSaveTemplateName}
  onConfirm={structure.submitSaveTemplate}
  onCancel={structure.closeSaveTemplate}
 />

 {/* Media Studio — gallery "Set as cover" crop overlay */}
 {galleryCropSource && (
 <CoverCropper
  sourceUrl={fullResUrl(galleryCropSource.url)}
  sourceKey={galleryCropSource.key}
  initialCrop={
   sessionCoverCrop?.key === galleryCropSource.key
    ? sessionCoverCrop.crop
    : coverCropFor(state.inspection as Record<string, unknown>, galleryCropSource.key)
  }
  onCancel={() => setGalleryCropSource(null)}
  onSave={(blob, c) => {
   const crop = { aspect: c.aspect, orientation: c.orientation, ...c.pixels };
   const source = galleryCropSource;
   // A repeat bakes a second derivative under a fresh random R2 key and orphans the first
   // (setCroppedCover), so a repeat of the same Save joins the one in flight; a different crop waits its turn.
   // The image is checked before the command is created (an image the server would refuse is announced, nothing
   // is sent and the cropper stays open); the dialog closes once the crop is on its way.
   void coverWrites.cropCoverChecked({
    sourceKey: source.key,
    crop: JSON.stringify(crop),
    image: new File([blob], "cover.jpg", { type: "image/jpeg" }),
   }).then((sent) => {
    if (!sent) return;
    setSessionCoverCrop({ key: source.key, crop });
    setGalleryCropSource(null);
   });
  }}
 />
 )}

 {/* #181 — Version history panel (collab Phase 4). Only reachable when the
     collabEditing flag is on (the trigger button is gated in EditorHeader).
     Live convergence for ALL clients (incl. the initiator) is now driven by the
     DO's MSG_RESTORE control frame (Task 12b): each client drops its local Y.Doc
     + IndexedDB and resyncs. The onRestored revalidate below is belt-and-braces —
     it refreshes loader data for the non-collab projection path. */}
 <VersionHistoryPanel
 open={versionHistoryOpen}
 onClose={() => setVersionHistoryOpen(false)}
 inspectionId={inspectionId}
 onRestored={() => { onReload(); }}
 doc={collabDoc}
 currentResults={state.results as unknown as ResultsProjection}
 />

 {/* Comment library drawer */}
 {caps.commentsLibrary && (
  <CommentLibraryDrawer
  open={state.showCommentLibrary}
  comments={{
  filterMode: comments.filterMode,
  setFilterMode: comments.setFilterMode,
  sort: comments.sort,
  setSort: comments.setSort,
  touchSnippet: comments.touchSnippet,
  }}
  state={{
  activeItem: state.activeItem,
  currentSection: state.currentSection,
  activeItemId: state.activeItemId,
  getResult: state.getResult,
  getRatingLabel: state.getRatingLabel,
  commentLibraryFilter: state.commentLibraryFilter,
  setCommentLibraryFilter: state.setCommentLibraryFilter,
  setCommentLibrarySelectedIdx: state.setCommentLibrarySelectedIdx,
  commentLibrarySearch: state.commentLibrarySearch,
  setCommentLibrarySearch: state.setCommentLibrarySearch,
  commentLibrarySelectedIdx: state.commentLibrarySelectedIdx,
  setShowCommentLibrary: state.setShowCommentLibrary,
  }}
  serverComments={serverComments}
  onInsert={onInsert}
  onClose={() => state.setShowCommentLibrary(false)}
  sheet={phone}
  />
 )}

 {/* Section picker modal */}
 <SectionPickerModal
 open={state.sectionPickerOpen}
 sectionPickerQuery={state.sectionPickerQuery}
 setSectionPickerQuery={state.setSectionPickerQuery}
 filteredSectionsForPicker={state.filteredSectionsForPicker}
 sections={state.sections}
 pickSection={state.pickSection}
 closeSectionPicker={state.closeSectionPicker}
 />

 {/* Tag picker modal */}
 <TagPickerModal
  open={tagPickerOpen && Boolean(state.activeItemId)}
  activeItemId={state.activeItemId ?? ""}
  tagsByItem={state.tagsByItem}
  presetTags={presetTags}
  onToggle={toggleTag}
  onClose={() => setTagPickerOpen(false)}
 />

 {/* Commercial PCA Phase U (Batch C2b) — units management drawer */}
 {showUnitsSurface && (
  <UnitsManager
   open={unitsManagerOpen}
   onClose={() => setUnitsManagerOpen(false)}
   inspectionId={inspectionId}
   units={units}
   mode={unitInspectionMode}
  />
 )}
 {/* Commercial PCA Phase C Task 13b — cost items drawer (Opinion of Cost) */}
 {showUnitsSurface && caps.costItems && (
  <CostItemsHost
   open={costItemsOpen}
   onClose={() => setCostItemsOpen(false)}
   inspectionId={inspectionId}
  />
 )}
    </>
  );
}
