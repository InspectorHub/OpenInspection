// @vitest-environment happy-dom
/**
 * F55 — deleting an inspection left its field data on the device forever.
 *
 * The server runs a full cascade (every row, every R2 object). The device kept
 * the `results-<id>` IndexedDB database that `y-indexeddb` writes for each
 * inspection a field user opens — holding real CRDT update payloads — and any
 * photo bytes still queued for upload. A walkthrough found two such databases
 * for inspections that had already been deleted server-side.
 *
 * fake-indexeddb is imported here rather than via a setup file, matching
 * `results-doc-connection.spec.ts`: the polyfill serves a handful of specs and
 * loading it globally would cost every other one.
 *
 * ⚠️ What these tests can and cannot establish. They prove the purge reaches
 * both local stores for the right inspection and leaves other inspections alone.
 * They say NOTHING about other devices — there is no mechanism for those, which
 * is the limitation documented at the top of `offline-purge.ts` rather than a
 * gap in this file.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";

import { purgeInspectionOfflineData } from "../../../app/lib/collab/offline-purge";
import {
    putPendingMedia,
    listPendingMedia,
} from "../../../app/lib/collab/media-pending-store";

const DELETED = "a1f069f7-0000-4000-8000-000000000001";
const SURVIVOR = "e7cf4375-0000-4000-8000-000000000002";

/** Write a real y-indexeddb database for an inspection, as opening it does. */
async function seedResultsDb(inspectionId: string, text: string): Promise<void> {
    const doc = new Y.Doc();
    const persistence = new IndexeddbPersistence("results-" + inspectionId, doc);
    await persistence.whenSynced;
    doc.getMap("results").set("probe", text);
    // `whenSynced` only covers the initial load; flush the update we just made.
    await persistence.whenSynced;
    await persistence.destroy();
}

/** True when a database of that name exists and holds at least one record. */
async function resultsDbHasData(inspectionId: string): Promise<boolean> {
    const doc = new Y.Doc();
    const persistence = new IndexeddbPersistence("results-" + inspectionId, doc);
    await persistence.whenSynced;
    const value = doc.getMap("results").get("probe");
    await persistence.destroy();
    return value !== undefined;
}

function pendingPhoto(inspectionId: string, pendingId: string) {
    return {
        pendingId,
        inspectionId,
        findingKey: "roof/shingles",
        kind: "photo" as const,
        blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" }),
        enqueuedAt: Date.now(),
    };
}

describe("purgeInspectionOfflineData", () => {
    beforeEach(async () => {
        await seedResultsDb(DELETED, "deficient: active leak at the valley");
        await seedResultsDb(SURVIVOR, "still an open inspection");
        await putPendingMedia(pendingPhoto(DELETED, "pend-deleted-1"));
        await putPendingMedia(pendingPhoto(DELETED, "pend-deleted-2"));
        await putPendingMedia(pendingPhoto(SURVIVOR, "pend-survivor-1"));
    });

    it("starts from a device that really is holding the data", async () => {
        // The control. Without this, every assertion below could pass against an
        // empty device and prove nothing — which is the failure mode the repo
        // notes as "an empty collection reads as green".
        expect(await resultsDbHasData(DELETED)).toBe(true);
        expect((await listPendingMedia(DELETED)).length).toBe(2);
    });

    it("removes the deleted inspection's Yjs database and queued media", async () => {
        const result = await purgeInspectionOfflineData(DELETED);

        expect(result.attempted).toBe(true);
        expect(result.pendingMediaDeleted).toBe(2);

        expect(await listPendingMedia(DELETED)).toEqual([]);
        // The field content itself — the thing that was surviving indefinitely.
        expect(await resultsDbHasData(DELETED)).toBe(false);
    });

    it("leaves every other inspection on the device untouched", async () => {
        await purgeInspectionOfflineData(DELETED);

        expect(await resultsDbHasData(SURVIVOR)).toBe(true);
        const survivors = await listPendingMedia(SURVIVOR);
        expect(survivors.map((r) => r.pendingId)).toEqual(["pend-survivor-1"]);
    });

    it("is safe to call for an inspection this device never opened", async () => {
        const result = await purgeInspectionOfflineData("never-seen-here");
        expect(result.attempted).toBe(true);
        expect(result.pendingMediaDeleted).toBe(0);
        // And it did not take the others with it.
        expect(await resultsDbHasData(DELETED)).toBe(true);
    });

    it("is a no-op without an id, and never rejects", async () => {
        await expect(purgeInspectionOfflineData("")).resolves.toMatchObject({ attempted: false });
    });
});
