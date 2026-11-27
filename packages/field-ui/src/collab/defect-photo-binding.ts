/**
 * Doc write helpers for a DEFECT row's own photos[] — the offline pending
 * lifecycle (append / resolve / drop). The online add path lives in
 * results-binding.ts (`addPhotoToCannedDefect` / `addPhotoToCustomDefect`);
 * this file is the defect-row mirror of the item-photo pending helpers
 * (`appendPendingPhoto` / `resolvePendingPhoto` / `dropPendingPhoto`).
 *
 * Why a separate file: results-binding.ts is at its file-size cap, and
 * every write to a defect's photos[] belongs in one place.
 *
 * Design (credit: NCHILLC's fork, commit 85669e05, reimplemented here for
 * upstream): a defect row's `photos` array holds the same `PhotoEntry` an
 * item's does, pending markers included, so an offline defect photo appends
 * a pending entry to the DEFECT's array — not the item's — and the drain
 * swaps the real R2 key into that same array. The queue record's
 * `targetType: 'defect'` (with `customId` / `defectKind`) is what tells the
 * drain which array to swap; the upload endpoint never cares.
 *
 * No React import.
 */

import type * as Y from 'yjs';
import { upsertCanned, upsertCustomComment } from '../shared/results-doc';
import {
    addPhotoToCannedDefect,
    addPhotoToCustomDefect,
    readResultMap,
} from './results-binding';

export type DefectRef = { kind: 'canned' | 'custom'; id: string };

type DefectPhoto = { key: string } & Record<string, unknown>;

/**
 * Read the defect row's current photos, or undefined when the row is not in
 * the doc. Read-only: a missing finding or defect writes nothing — a photo
 * whose row was deleted while it sat in the queue has nowhere to land, and
 * the drain still drops the record (the bytes reached R2; re-queueing would
 * retry forever).
 */
function readDefectPhotos(
    doc: Y.Doc,
    fk: string,
    ref: DefectRef,
): DefectPhoto[] | undefined {
    const entry = readResultMap(doc)[fk];
    if (!entry) return undefined;
    if (ref.kind === 'canned') {
        const tabs = entry.tabs as
            | { defects?: Array<{ cannedId: string; photos?: DefectPhoto[] }> }
            | undefined;
        return tabs?.defects?.find((d) => d.cannedId === ref.id)?.photos;
    }
    const customComments = entry.customComments as
        | { defects?: Array<{ id: string; photos?: DefectPhoto[] }> }
        | undefined;
    return customComments?.defects?.find((d) => d.id === ref.id)?.photos;
}

/**
 * Replace a defect row's photos array wholesale (the same element-level LWW
 * the add helpers use). No-op when the row is not in the doc.
 */
function patchDefectPhotos(
    doc: Y.Doc,
    fk: string,
    ref: DefectRef,
    next: (photos: DefectPhoto[]) => DefectPhoto[],
): void {
    const existing = readDefectPhotos(doc, fk, ref);
    if (existing === undefined) return;
    const photos = next(existing);
    if (ref.kind === 'canned') {
        upsertCanned(doc, fk, 'defects', { cannedId: ref.id, photos });
    } else {
        upsertCustomComment(doc, fk, 'defects', { id: ref.id, photos });
    }
}

/**
 * Append a brand-new OFFLINE photo to a defect row as a PENDING entry. The
 * defect-row mirror of `appendPendingPhoto`.
 *
 * The bytes live only in the local media-pending store until the drain runs,
 * so the entry carries an empty `key` + `pendingUpload` + the `pendingId`
 * that resolves to the local blob — the same shape the item path already
 * uses, which is why the defect chip's photo count includes it and the
 * report skips it with no new cases.
 *
 * Takes sectionId/itemId rather than a findingKey because it delegates to
 * the two add helpers, which own the dedup and the "no such defect row"
 * no-op; re-deriving their key here would only add a way to disagree.
 */
export function appendPendingPhotoToDefect(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    ref: DefectRef,
    pendingId: string,
    unitId: string | null = null,
): void {
    const photo = {
        key: '',
        pendingUpload: true,
        pendingId,
        pendingKind: 'photo',
        mediaType: 'photo',
    };
    if (ref.kind === 'canned') {
        addPhotoToCannedDefect(doc, sectionId, itemId, ref.id, photo, unitId);
    } else {
        addPhotoToCustomDefect(doc, sectionId, itemId, ref.id, photo, unitId);
    }
}

/**
 * Swap a pending defect photo to its real R2 key once the drain has
 * uploaded it. The defect-row mirror of `resolvePendingPhoto`.
 *
 * Addressed by `pendingId`, never by `key`: every pending entry's key is
 * the empty string until this runs, so two offline captures on one defect
 * are indistinguishable by key.
 */
export function resolvePendingDefectPhoto(
    doc: Y.Doc,
    fk: string,
    ref: DefectRef,
    pendingId: string,
    key: string,
): void {
    patchDefectPhotos(doc, fk, ref, (photos) =>
        photos.map((p) => {
            if (p.pendingId !== pendingId) return p;
            const { pendingUpload: _u, pendingId: _p, pendingKind: _k, ...keep } = p;
            void _u;
            void _p;
            void _k;
            return { ...keep, key };
        }),
    );
}

/**
 * Remove a pending defect photo once the host has permanently refused its
 * bytes. The defect-row mirror of `dropPendingPhoto`: addressed by
 * `pendingId`, a no-op when no photo carries it.
 */
export function dropPendingDefectPhoto(
    doc: Y.Doc,
    fk: string,
    ref: DefectRef,
    pendingId: string,
): void {
    patchDefectPhotos(doc, fk, ref, (photos) => photos.filter((p) => p.pendingId !== pendingId));
}