import { useState, useCallback, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { findingKey } from "~/hooks/findings/shared";
import {
  addSection, duplicateSection, deleteSection, moveSection, reorderSection, renameSection,
  addItem, duplicateItem, deleteItem, moveItem, renameItem,
} from "~/lib/editor/structure-ops";
import type { Snapshot, ItemType } from "~/lib/editor/structure-ops";
import { m } from "~/paraglide/messages";

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
  /** The inspection's source template id (enables "save structure back to template"). */
  templateId?: string | null;
  /**
   * Phase U (Batch C2a) — the active per-unit scope. `null`/undefined (default)
   * = the `_default` common scope, so the delete-impact tally is byte-identical
   * to before this change. When a unit is active, `itemImpact` reads the finding
   * under `findingKey(activeUnitId, …)` and never falls back to the ambiguous
   * bare itemId (two units share an itemId in per-unit mode).
   */
  activeUnitId?: string | null;
  /**
   * Optimistic display sync — called with the next snapshot on every structural
   * edit so the editor's section list updates immediately (POST persistence +
   * shouldRevalidate's POST skip mean the loader never refreshes on its own).
   */
  onApply?: (snapshot: Snapshot) => void;
}

/** Open "save structure to template" modal state. */
export interface SaveTemplatePending {
  mode: "back" | "new";
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
  /** Reorder a section via drag-and-drop (move `fromId` to `toId`'s position). */
  reorderSection: (fromId: string, toId: string) => void;
  /** Rename a section's title inline. */
  renameSection: (id: string, title: string) => void;
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
  /** Rename an item's label inline. */
  renameItem: (sectionId: string, itemId: string, label: string) => void;
  /** Pending "Add item" type-picker state — non-null while the AddItemTypeModal is open. */
  addItemPending: AddItemPending | null;
  /** Open the "Add item" type-picker for a section. */
  openAddItemPrompt: (sectionId: string) => void;
  /** Close the "Add item" type-picker without adding. */
  closeAddItemPrompt: () => void;
  /** Confirm the "Add item" prompt — adds the item (label+type) and closes the prompt. */
  submitAddItem: (label: string, type: ItemType) => void;
  /** Whether the inspection has a source template (enables "Save → template"). */
  canSaveBack: boolean;
  /** Pending save-to-template modal state — non-null while the modal is open. */
  saveTemplatePending: SaveTemplatePending | null;
  /** Open the save-to-template modal in 'back' (update source) or 'new' (fork) mode. */
  openSaveTemplate: (mode: "back" | "new") => void;
  /** Close the save-to-template modal without saving. */
  closeSaveTemplate: () => void;
  /** Controlled name input for the 'new' template mode. */
  saveTemplateName: string;
  setSaveTemplateName: (value: string) => void;
  /** Confirm the save-to-template modal — submits the action and closes. */
  submitSaveTemplate: () => void;
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
  templateId,
  activeUnitId = null,
  onApply,
}: UseStructureEditOptions): UseStructureEditReturn {
  // Hold the RAW snapshot in a ref so ops always operate on a clean
  // TemplateSchemaV2 object. Updated when loaderData refreshes after each
  // applyStructure revalidation.
  const snapshotRef = useRef<Snapshot>(rawSnapshot as Snapshot);
  useEffect(() => {
    snapshotRef.current = rawSnapshot as Snapshot;
  }, [rawSnapshot]);

  const structureFetcher = useFetcher();

  // Kept in a ref so applyStructure's identity is stable even though the caller
  // passes a fresh onApply closure each render.
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;

  const applyStructure = useCallback(
    (next: Snapshot) => {
      // Optimistic display refresh (see UseStructureEditOptions.onApply).
      onApplyRef.current?.(next);
      // Advance the ref optimistically so a second structural op fired before
      // the action→revalidation round-trip composes on top of this change.
      // The PATCH replaces the whole snapshot (last-write-wins); without this,
      // chained edits (e.g. "Add section" then a quick "Move up") would each
      // recompute from the pre-first-op snapshot and silently drop the first.
      // The rawSnapshot effect reconciles back to server truth on revalidation.
      snapshotRef.current = next;
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
  // Phase U (Batch C2a): read the finding under the ACTIVE unit. The bare-itemId
  // fallback is only consulted in the `_default` view (activeUnitId == null) —
  // under a real unit the bare key is ambiguous (two units share an itemId), so
  // it must never let one unit's impact shadow another. At activeUnitId == null
  // `findingKey(null, …)` === `_default:{sectionId}:{itemId}`, so the tally is
  // byte-identical to before this change.
  const itemImpact = useCallback(
    (sectionId: string, itemId: string) => {
      const ck = findingKey(activeUnitId, sectionId, itemId);
      const r = (results[ck] || (activeUnitId == null ? results[itemId] : undefined)) as
        | Record<string, unknown>
        | undefined;
      const ratings = (r as { rating?: unknown } | undefined)?.rating ? 1 : 0;
      const n = r?.notes;
      const notes = typeof n === "string" && n.trim() ? 1 : 0;
      const p = r?.photos;
      const photos = Array.isArray(p) ? p.length : 0;
      return { ratings, notes, photos };
    },
    [results, activeUnitId],
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
    const title = addSectionTitle.trim() || m.helper_structure_new_section_default();
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

  const handleReorderSection = useCallback(
    (fromId: string, toId: string) => {
      applyStructure(reorderSection(snapshotRef.current, fromId, toId));
    },
    [applyStructure],
  );

  const handleRenameSection = useCallback(
    (id: string, title: string) => {
      applyStructure(renameSection(snapshotRef.current, id, title));
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

  const handleRenameItem = useCallback(
    (sectionId: string, itemId: string, label: string) => {
      applyStructure(renameItem(snapshotRef.current, sectionId, itemId, label));
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
      const clean = label.trim() || m.helper_structure_new_item_default();
      applyStructure(addItem(snapshotRef.current, pending.sectionId, clean, type));
    },
    [addItemPending, applyStructure],
  );

  // ── Save structure → template / as new template ─────────────────────────────
  const [saveTemplatePending, setSaveTemplatePending] = useState<SaveTemplatePending | null>(null);
  const [saveTemplateName, setSaveTemplateName] = useState("");

  const openSaveTemplate = useCallback((mode: "back" | "new") => {
    setSaveTemplateName("");
    setSaveTemplatePending({ mode });
  }, []);

  const closeSaveTemplate = useCallback(() => {
    setSaveTemplatePending(null);
  }, []);

  const submitSaveTemplate = useCallback(() => {
    const pending = saveTemplatePending;
    setSaveTemplatePending(null);
    if (!pending) return;
    const fields: Record<string, string> = {
      intent: "save-structure-template",
      mode: pending.mode,
      snapshot: JSON.stringify(snapshotRef.current),
    };
    if (pending.mode === "new") {
      fields.name = saveTemplateName.trim() || m.helper_structure_custom_template_default();
    } else {
      fields.templateId = templateId ?? "";
    }
    structureFetcher.submit(fields, { method: "post" });
  }, [saveTemplatePending, saveTemplateName, templateId, structureFetcher]);

  return {
    snapshotRef,
    applyStructure,
    addSection: openAddSectionPrompt,
    duplicateSection: handleDuplicateSection,
    deleteSection: handleDeleteSection,
    moveSection: handleMoveSection,
    reorderSection: handleReorderSection,
    renameSection: handleRenameSection,
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
    renameItem: handleRenameItem,
    addItemPending,
    openAddItemPrompt,
    closeAddItemPrompt,
    submitAddItem,
    // save-to-template
    canSaveBack: Boolean(templateId),
    saveTemplatePending,
    openSaveTemplate,
    closeSaveTemplate,
    saveTemplateName,
    setSaveTemplateName,
    submitSaveTemplate,
  };
}
