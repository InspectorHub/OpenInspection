import { useState, useCallback, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { addSection, duplicateSection, deleteSection, moveSection } from "~/lib/editor/structure-ops";
import type { Snapshot } from "~/lib/editor/structure-ops";

/** Impact data shown in the StructureDeleteModal. */
export interface SectionDeletePending {
  sectionId: string;
  title: string;
  impact: { items: number; ratings: number; notes: number; photos: number };
}

export interface UseStructureEditOptions {
  /** Raw template snapshot from loaderData (refreshes after each applyStructure revalidation). */
  rawSnapshot: unknown;
  /** Whether collaborative editing is active (controls the collab flag on the restructure submit). */
  collabEditing: boolean;
  /** Live results map from inspection state (used to compute delete impact). */
  results: Record<string, unknown>;
}

export interface UseStructureEditReturn {
  /** Ref to the live snapshot — ops always read from this. */
  snapshotRef: React.MutableRefObject<Snapshot>;
  /** Submit a restructure action with the given next snapshot. */
  applyStructure: (next: Snapshot) => void;
  /** Open the "Add section" title prompt. */
  addSection: () => void;
  /** Duplicate an existing section by id. */
  duplicateSection: (id: string) => void;
  /**
   * Compute delete impact and open the StructureDeleteModal.
   * The actual deletion fires only when the user confirms via confirmDelete.
   */
  deleteSection: (id: string) => void;
  /** Move a section up (-1) or down (1). */
  moveSection: (id: string, dir: -1 | 1) => void;
  /** Pending delete state — non-null while the StructureDeleteModal is open. */
  deletePending: SectionDeletePending | null;
  /** Confirm the pending delete and fire the restructure action. */
  confirmDelete: () => void;
  /** Cancel the pending delete (close the modal without deleting). */
  cancelDelete: () => void;
  /** Whether the "Add section" title prompt is open. */
  addSectionPromptOpen: boolean;
  /** Current value of the add-section title input. */
  addSectionTitle: string;
  /** Open the "Add section" title prompt (resets the title). */
  openAddSectionPrompt: () => void;
  /** Close the "Add section" title prompt without adding. */
  closeAddSectionPrompt: () => void;
  /** Controlled setter for the add-section title input. */
  setAddSectionTitle: (value: string) => void;
  /** Confirm the "Add section" prompt — adds the section and closes the prompt. */
  submitAddSection: () => void;
}

/**
 * D8 — structural section editing wiring.
 *
 * Holds the snapshot ref + structureFetcher + all section CRUD handlers
 * (add / duplicate / delete / move) and the two modal state pieces
 * (StructureDeleteModal and the "Add section" title prompt).
 *
 * Extracted from inspection-edit.tsx to keep it below the file-size ratchet
 * and to make the pattern reusable for upcoming item-level structural ops.
 */
export function useStructureEdit({
  rawSnapshot,
  collabEditing,
  results,
}: UseStructureEditOptions): UseStructureEditReturn {
  // Hold the RAW snapshot in a ref so ops always operate on a clean
  // TemplateSchemaV2 object. Updated when loaderData refreshes after each
  // applyStructure revalidation.
  const snapshotRef = useRef<Snapshot>(rawSnapshot as Snapshot);
  useEffect(() => {
    snapshotRef.current = rawSnapshot as Snapshot;
  }, [rawSnapshot]);

  const structureFetcher = useFetcher();

  const applyStructure = useCallback(
    (next: Snapshot) => {
      structureFetcher.submit(
        {
          intent: "restructure",
          snapshot: JSON.stringify(next),
          collab: collabEditing ? "1" : "0",
        },
        { method: "post" },
      );
    },
    [structureFetcher, collabEditing],
  );

  // StructureDeleteModal state — opened when deleteSection fires.
  const [deletePending, setDeletePending] = useState<SectionDeletePending | null>(null);

  const handleDeleteSection = useCallback(
    (id: string) => {
      const sec = snapshotRef.current.sections.find((s) => s.id === id);
      if (!sec) return;
      // Compute impact from the snapshot item list + live results.
      const sectionItems = sec.items as Array<{ id: string }>;
      let ratings = 0;
      let notes = 0;
      let photos = 0;
      for (const item of sectionItems) {
        const r = (results[`_default:${id}:${item.id}`] || results[item.id]) as
          | Record<string, unknown>
          | undefined;
        if ((r as { rating?: unknown } | undefined)?.rating) ratings++;
        const n = r?.notes;
        if (typeof n === "string" && n.trim()) notes++;
        const p = r?.photos;
        if (Array.isArray(p)) photos += p.length;
      }
      setDeletePending({
        sectionId: id,
        title: sec.title,
        impact: { items: sectionItems.length, ratings, notes, photos },
      });
    },
    [results],
  );

  const confirmDelete = useCallback(() => {
    const pending = deletePending;
    setDeletePending(null);
    if (pending) applyStructure(deleteSection(snapshotRef.current, pending.sectionId));
  }, [deletePending, applyStructure]);

  const cancelDelete = useCallback(() => {
    setDeletePending(null);
  }, []);

  // "Add section" title prompt state.
  const [addSectionPromptOpen, setAddSectionPromptOpen] = useState(false);
  const [addSectionTitle, setAddSectionTitle] = useState("");

  const openAddSectionPrompt = useCallback(() => {
    setAddSectionTitle("");
    setAddSectionPromptOpen(true);
  }, []);

  const closeAddSectionPrompt = useCallback(() => {
    setAddSectionPromptOpen(false);
  }, []);

  const submitAddSection = useCallback(() => {
    const title = addSectionTitle.trim() || "New Section";
    setAddSectionPromptOpen(false);
    setAddSectionTitle("");
    applyStructure(addSection(snapshotRef.current, title));
  }, [addSectionTitle, applyStructure]);

  const handleDuplicateSection = useCallback(
    (id: string) => {
      applyStructure(duplicateSection(snapshotRef.current, id));
    },
    [applyStructure],
  );

  const handleMoveSection = useCallback(
    (id: string, dir: -1 | 1) => {
      applyStructure(moveSection(snapshotRef.current, id, dir));
    },
    [applyStructure],
  );

  return {
    snapshotRef,
    applyStructure,
    addSection: openAddSectionPrompt,
    duplicateSection: handleDuplicateSection,
    deleteSection: handleDeleteSection,
    moveSection: handleMoveSection,
    deletePending,
    confirmDelete,
    cancelDelete,
    addSectionPromptOpen,
    addSectionTitle,
    openAddSectionPrompt,
    closeAddSectionPrompt,
    setAddSectionTitle,
    submitAddSection,
  };
}
