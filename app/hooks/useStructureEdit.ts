import { useState, useCallback, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import {
  addSection, duplicateSection, deleteSection, moveSection,
  addItem, duplicateItem, deleteItem, moveItem,
} from "~/lib/editor/structure-ops";
import type { Snapshot, ItemType } from "~/lib/editor/structure-ops";

/** Impact data shown in the StructureDeleteModal — for a section OR a single item. */
export interface DeletePending {
  kind: "section" | "item";
  sectionId: string;
  /** Present only when kind === 'item'. */
  itemId?: string;
  title: string;
  impact: { items: number; ratings: number; notes: number; photos: number };
}

/** Open "Add item" type-picker state. */
export interface AddItemPending {
  sectionId: string;
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
  /** Pending delete state — non-null while the StructureDeleteModal is open (section OR item). */
  deletePending: DeletePending | null;
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
  /** Duplicate an item within a section. */
  duplicateItem: (sectionId: string, itemId: string) => void;
  /** Compute item delete impact and open the StructureDeleteModal. */
  deleteItem: (sectionId: string, itemId: string) => void;
  /** Move an item up (-1) or down (1) within its section. */
  moveItem: (sectionId: string, itemId: string, dir: -1 | 1) => void;
  /** Pending "Add item" type-picker state — non-null while the AddItemTypeModal is open. */
  addItemPending: AddItemPending | null;
  /** Open the "Add item" type-picker for a section. */
  openAddItemPrompt: (sectionId: string) => void;
  /** Close the "Add item" type-picker without adding. */
  closeAddItemPrompt: () => void;
  /** Confirm the "Add item" prompt — adds the item (label+type) and closes the prompt. */
  submitAddItem: (label: string, type: ItemType) => void;
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

  // StructureDeleteModal state — opened when a section/item delete fires.
  const [deletePending, setDeletePending] = useState<DeletePending | null>(null);

  // Tally rating/notes/photos for one item id within a section from live results.
  const itemImpact = useCallback(
    (sectionId: string, itemId: string) => {
      const r = (results[`_default:${sectionId}:${itemId}`] || results[itemId]) as
        | Record<string, unknown>
        | undefined;
      const ratings = (r as { rating?: unknown } | undefined)?.rating ? 1 : 0;
      const n = r?.notes;
      const notes = typeof n === "string" && n.trim() ? 1 : 0;
      const p = r?.photos;
      const photos = Array.isArray(p) ? p.length : 0;
      return { ratings, notes, photos };
    },
    [results],
  );

  const handleDeleteSection = useCallback(
    (id: string) => {
      const sec = snapshotRef.current.sections.find((s) => s.id === id);
      if (!sec) return;
      const sectionItems = sec.items as Array<{ id: string }>;
      let ratings = 0;
      let notes = 0;
      let photos = 0;
      for (const item of sectionItems) {
        const i = itemImpact(id, item.id);
        ratings += i.ratings;
        notes += i.notes;
        photos += i.photos;
      }
      setDeletePending({
        kind: "section",
        sectionId: id,
        title: sec.title,
        impact: { items: sectionItems.length, ratings, notes, photos },
      });
    },
    [itemImpact],
  );

  const handleDeleteItem = useCallback(
    (sectionId: string, itemId: string) => {
      const sec = snapshotRef.current.sections.find((s) => s.id === sectionId);
      const item = (sec?.items as Array<{ id: string; label: string }> | undefined)?.find(
        (it) => it.id === itemId,
      );
      if (!item) return;
      const i = itemImpact(sectionId, itemId);
      setDeletePending({
        kind: "item",
        sectionId,
        itemId,
        title: item.label,
        impact: { items: 1, ...i },
      });
    },
    [itemImpact],
  );

  const confirmDelete = useCallback(() => {
    const pending = deletePending;
    setDeletePending(null);
    if (!pending) return;
    if (pending.kind === "item" && pending.itemId) {
      applyStructure(deleteItem(snapshotRef.current, pending.sectionId, pending.itemId));
    } else {
      applyStructure(deleteSection(snapshotRef.current, pending.sectionId));
    }
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

  // ── Item-level handlers (mirror the section ones over the item ops) ──────────
  const handleDuplicateItem = useCallback(
    (sectionId: string, itemId: string) => {
      applyStructure(duplicateItem(snapshotRef.current, sectionId, itemId));
    },
    [applyStructure],
  );

  const handleMoveItem = useCallback(
    (sectionId: string, itemId: string, dir: -1 | 1) => {
      applyStructure(moveItem(snapshotRef.current, sectionId, itemId, dir));
    },
    [applyStructure],
  );

  // "Add item" type-picker state.
  const [addItemPending, setAddItemPending] = useState<AddItemPending | null>(null);

  const openAddItemPrompt = useCallback((sectionId: string) => {
    setAddItemPending({ sectionId });
  }, []);

  const closeAddItemPrompt = useCallback(() => {
    setAddItemPending(null);
  }, []);

  const submitAddItem = useCallback(
    (label: string, type: ItemType) => {
      const pending = addItemPending;
      setAddItemPending(null);
      if (!pending) return;
      const clean = label.trim() || "New Item";
      applyStructure(addItem(snapshotRef.current, pending.sectionId, clean, type));
    },
    [addItemPending, applyStructure],
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
    // item-level
    duplicateItem: handleDuplicateItem,
    deleteItem: handleDeleteItem,
    moveItem: handleMoveItem,
    addItemPending,
    openAddItemPrompt,
    closeAddItemPrompt,
    submitAddItem,
  };
}
