/**
 * Pure (React-free) collab write-API builder for the inspection editor.
 *
 * `useFindings` returns ~19 write functions. When the `collabEditing` flag is on
 * and a live Y.Doc is present, the editor must route those writes to the Y.Doc
 * (via `./results-binding`) instead of the legacy fetcher / offline-queue path.
 * To keep this unit-testable without a React render harness, the collab write
 * surface lives here as a PURE builder and `useFindings` returns it 1:1.
 *
 * Every returned function's signature MUST match the legacy `useFindings`
 * return EXACTLY so the editor calls them unchanged. See #181 PR-C, Task 9b.
 *
 * NO React import.
 */

import type * as Y from 'yjs';
import { findingKey } from '../../../server/lib/finding-key';
import { cloneByScope } from '../../hooks/findings/shared';
import type {
    AttachedRepairItem,
    CustomCommentEntry,
} from '../../hooks/findings/shared';
import type { ResultMap } from './results-binding';
import {
    setRating as bindingSetRating,
    setNotes as bindingSetNotes,
    setValue as bindingSetValue,
    toggleCanned as bindingToggleCanned,
    setDefectFields as bindingSetDefectFields,
    appendPhoto as bindingAppendPhoto,
    appendNote as bindingAppendNote,
    addCustomDefect as bindingAddCustomDefect,
    toggleCustomDefect as bindingToggleCustomDefect,
    attachRepairItem as bindingAttachRepairItem,
    detachRepairItem as bindingDetachRepairItem,
    addPhotoToCannedDefect as bindingAddPhotoToCannedDefect,
    addPhotoToCustomDefect as bindingAddPhotoToCustomDefect,
} from './results-binding';

/** Save-status the editor surfaces. Mirrors the legacy `setSaveStatus` arg. */
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * The deps the editor wires in (all already available on the editor side).
 * `getResult` reads `results` (which the editor feeds from the doc projection
 * via `bindResultMap`); `setResults` is only used for the optimistic notes echo.
 */
export interface CollabFindingsDeps {
    getResult: (itemId: string, sectionId?: string) => Record<string, unknown>;
    sectionIdForItem: (itemId: string) => string | null;
    setResults: (fn: (prev: ResultMap) => ResultMap) => void;
    setDirty: (v: boolean) => void;
    setSaveStatus: (s: SaveStatus) => void;
    /**
     * Phase U (Batch C1) — the editor's active per-unit scope. `null`/undefined
     * (the default) means the `_default` common scope, so behavior is identical
     * to before this change. When a unit is active every write is keyed to that
     * unit (`findingKey(activeUnitId, …)`), so two units sharing an itemId never
     * collide. `getResult` is supplied ALREADY scoped by the editor, so reads
     * here go through it unchanged.
     */
    activeUnitId?: string | null;
}

/**
 * The collab write API — structurally identical to the legacy `useFindings`
 * return so the editor can consume it without changes.
 */
export interface CollabFindingsApi {
    getResult: (itemId: string, sectionId?: string) => Record<string, unknown>;
    setRating: (sectionId: string, itemId: string, rating: string | null) => void;
    setNotes: (sectionId: string, itemId: string, notes: string) => void;
    commitNotes: (sectionId: string, itemId: string, notes: string) => void;
    setItemValue: (sectionId: string, itemId: string, value: unknown) => void;
    toggleCannedComment: (
        sectionId: string,
        itemId: string,
        tabName: string,
        cannedId: string,
        included: boolean,
    ) => void;
    setDefectFields: (
        sectionId: string,
        itemId: string,
        cannedId: string,
        patch: { location?: string | null; trade?: string | null; deadline?: string | null; timeframe?: string | null },
    ) => void;
    insertComment: (
        sectionId: string,
        itemId: string,
        text: string,
        withExtraNewline?: boolean,
    ) => void;
    cloneLast: (
        sectionId: string,
        itemId: string,
        sectionItems: Array<{ id: string }>,
        scope: 'rating' | 'rating_notes' | 'all',
    ) => boolean;
    batchSetRating: (
        sectionId: string,
        items: Array<{ id: string }>,
        selected: Record<string, boolean>,
        levelId: string,
    ) => number;
    addPhotoToItem: (itemId: string, photoKey: string) => void;
    addPhotoToDefect: (
        itemId: string,
        target: { kind: 'canned' | 'custom'; id: string },
        photoKey: string,
    ) => void;
    getPhotoCount: (itemId: string) => number;
    addCustomDefect: (sectionId: string, itemId: string, defect: CustomCommentEntry) => void;
    toggleCustomDefect: (sectionId: string, itemId: string, customId: string, included: boolean) => void;
    attachRepairItem: (itemId: string, snap: AttachedRepairItem) => void;
    detachRepairItem: (itemId: string, recommendationId: string) => void;
    debounceSave: () => void;
    saveNow: () => void;
}

/**
 * Build the collab write API. Every write goes to `doc` via the binding; reads
 * go through `deps.getResult` (the editor feeds it from the doc projection).
 */
export function buildCollabFindingsApi(doc: Y.Doc, deps: CollabFindingsDeps): CollabFindingsApi {
    const { getResult, sectionIdForItem, setResults, setDirty, setSaveStatus } = deps;
    // Phase U (Batch C1): resolve the active per-unit scope once. `null` = the
    // `_default` common scope (byte-identical to pre-Phase-U behavior). Threaded
    // into every write binding so a non-null unit keys ONLY that unit's finding.
    const unit = deps.activeUnitId ?? null;

    const setRating = (sectionId: string, itemId: string, rating: string | null): void => {
        bindingSetRating(doc, sectionId, itemId, rating, unit);
        setDirty(true);
    };

    // OPTIMISTIC LOCAL ONLY — do NOT write the doc here. Writing every keystroke
    // through the doc/observer round-trips back into `results` and jumps the
    // textarea cursor. The doc write happens on blur via `commitNotes`.
    //
    // Phase U (Batch C1): the bare `itemId` slot holds only ONE unit's entry, so
    // we only mirror the echo there in the common scope (`unit == null`) — the
    // legacy dual-key read pattern. Under a real unit the composite key IS what
    // the read resolvers consult, so writing the shared bare slot would leak this
    // unit's optimistic notes into another unit that lacks a composite entry.
    const setNotes = (sectionId: string, itemId: string, notes: string): void => {
        const key = findingKey(unit, sectionId, itemId);
        setResults((prev) => {
            const bare = unit == null ? ((prev[itemId] as Record<string, unknown>) || {}) : {};
            const merged = {
                ...((prev[key] as Record<string, unknown>) || {}),
                ...bare,
                notes,
            };
            return unit == null
                ? { ...prev, [key]: merged, [itemId]: merged }
                : { ...prev, [key]: merged };
        });
        setDirty(true);
    };

    const commitNotes = (sectionId: string, itemId: string, notes: string): void => {
        bindingSetNotes(doc, sectionId, itemId, notes, unit);
        setDirty(true);
    };

    const setItemValue = (sectionId: string, itemId: string, value: unknown): void => {
        bindingSetValue(doc, sectionId, itemId, value, unit);
        setDirty(true);
    };

    const toggleCannedComment = (
        sectionId: string,
        itemId: string,
        tabName: string,
        cannedId: string,
        included: boolean,
    ): void => {
        bindingToggleCanned(doc, sectionId, itemId, tabName as 'information' | 'limitations' | 'defects', cannedId, included, unit);
        setDirty(true);
    };

    const setDefectFields = (
        sectionId: string,
        itemId: string,
        cannedId: string,
        patch: { location?: string | null; trade?: string | null; deadline?: string | null; timeframe?: string | null },
    ): void => {
        bindingSetDefectFields(doc, sectionId, itemId, cannedId, patch as Record<string, unknown>, unit);
        setDirty(true);
    };

    const insertComment = (
        sectionId: string,
        itemId: string,
        text: string,
        withExtraNewline = false,
    ): void => {
        bindingAppendNote(doc, sectionId, itemId, text, withExtraNewline, unit);
        setDirty(true);
    };

    // Mirrors the legacy cloneLast: scan `sectionItems` backwards from `itemId`
    // for the first prior item with a rating, then project by scope onto the
    // target finding. Writes go straight to the doc (rating scalar always; notes
    // scalar when the scope carries it).
    const cloneLast = (
        sectionId: string,
        itemId: string,
        sectionItems: Array<{ id: string }>,
        scope: 'rating' | 'rating_notes' | 'all',
    ): boolean => {
        const activeIdx = sectionItems.findIndex((it) => it.id === itemId);
        let priorResult: Record<string, unknown> | null = null;
        for (let i = activeIdx - 1; i >= 0; i--) {
            const r = getResult(sectionItems[i].id, sectionId);
            if (r && r.rating) {
                priorResult = r;
                break;
            }
        }
        if (!priorResult) return false;
        const projected = cloneByScope(priorResult, scope);
        if ('rating' in projected) {
            bindingSetRating(doc, sectionId, itemId, (projected.rating as string | null) ?? null, unit);
        }
        if ('notes' in projected && typeof projected.notes === 'string') {
            bindingSetNotes(doc, sectionId, itemId, projected.notes, unit);
        }
        setDirty(true);
        return true;
    };

    const batchSetRating = (
        sectionId: string,
        items: Array<{ id: string }>,
        selected: Record<string, boolean>,
        levelId: string,
    ): number => {
        let count = 0;
        for (const item of items) {
            if (!selected[item.id]) continue;
            bindingSetRating(doc, sectionId, item.id, levelId, unit);
            count++;
        }
        setDirty(true);
        return count;
    };

    const addPhotoToItem = (itemId: string, photoKey: string): void => {
        const sid = sectionIdForItem(itemId);
        if (!sid) return;
        bindingAppendPhoto(doc, sid, itemId, { key: photoKey }, unit);
        setDirty(true);
    };

    const addPhotoToDefect = (
        itemId: string,
        target: { kind: 'canned' | 'custom'; id: string },
        photoKey: string,
    ): void => {
        const sid = sectionIdForItem(itemId);
        if (!sid) return;
        if (target.kind === 'canned') {
            bindingAddPhotoToCannedDefect(doc, sid, itemId, target.id, { key: photoKey }, unit);
        } else {
            bindingAddPhotoToCustomDefect(doc, sid, itemId, target.id, { key: photoKey }, unit);
        }
        setDirty(true);
    };

    // Mirrors the legacy read: count `photos` on the resolved entry.
    const getPhotoCount = (itemId: string): number => {
        const r = getResult(itemId);
        const photos = r.photos as unknown[] | undefined;
        return Array.isArray(photos) ? photos.length : 0;
    };

    const addCustomDefect = (sectionId: string, itemId: string, defect: CustomCommentEntry): void => {
        // CustomCommentEntry has no index signature; the binding only needs `id`
        // plus arbitrary fields. Widen via unknown (structurally compatible).
        bindingAddCustomDefect(doc, sectionId, itemId, defect as unknown as { id: string } & Record<string, unknown>, unit);
        setDirty(true);
    };

    const toggleCustomDefect = (
        sectionId: string,
        itemId: string,
        customId: string,
        included: boolean,
    ): void => {
        bindingToggleCustomDefect(doc, sectionId, itemId, customId, included, unit);
        setDirty(true);
    };

    const attachRepairItem = (itemId: string, snap: AttachedRepairItem): void => {
        const sid = sectionIdForItem(itemId);
        if (!sid) return;
        bindingAttachRepairItem(doc, sid, itemId, snap, unit);
        setDirty(true);
    };

    const detachRepairItem = (itemId: string, recommendationId: string): void => {
        const sid = sectionIdForItem(itemId);
        if (!sid) return;
        bindingDetachRepairItem(doc, sid, itemId, recommendationId, unit);
        setDirty(true);
    };

    // No-op in collab: the Durable Object persists the doc; there is no save-all
    // round-trip to debounce or flush. Surface a settled status so the editor's
    // save indicator does not hang on "saving".
    const debounceSave = (): void => {
        setSaveStatus('saved');
    };
    const saveNow = (): void => {
        setSaveStatus('saved');
    };

    return {
        getResult,
        setRating,
        setNotes,
        commitNotes,
        setItemValue,
        toggleCannedComment,
        setDefectFields,
        insertComment,
        cloneLast,
        batchSetRating,
        addPhotoToItem,
        addPhotoToDefect,
        getPhotoCount,
        addCustomDefect,
        toggleCustomDefect,
        attachRepairItem,
        detachRepairItem,
        debounceSave,
        saveNow,
    };
}
