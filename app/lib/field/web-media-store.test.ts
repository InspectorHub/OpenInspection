// @vitest-environment happy-dom
/**
 * The IndexedDB implementation of the field-ui `PendingMediaStore`.
 *
 * Pending photos already sit in users' browsers, so the database name, version,
 * object store, key path and stored row shape are pinned here against RAW
 * IndexedDB access (not through the module under test): a change to any of them
 * would orphan photos that have not uploaded yet.
 *
 * Uses fake-indexeddb, no server. Imported here rather than through a global
 * setup file, which would load the polyfill for every spec.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import type { PendingMediaRecord } from "@core/field-ui/media-types";
import { addOfflinePhotos } from "@core/field-ui/collab/offline-photo-batch";
import { offlinePhotoRejectionMessages } from "@core/field-ui/editor/photo-rejection-messages";
import { projectResults, seedResultsDoc } from "@core/field-ui/shared/results-doc";
import * as Y from "yjs";
import { MAX_PHOTO_BYTES } from "../../../server/lib/media/store-photo";
import { sniffPhotoType } from "../../../server/lib/media/sniff";
import {
    webMediaStore,
    toStored,
    fromStored,
    WEB_MEDIA_DB_NAME,
    WEB_MEDIA_DB_VERSION,
    WEB_MEDIA_STORE_NAME,
    WEB_MEDIA_KEY_PATH,
    type StoredPendingMedia,
} from "./web-media-store";

// ─── Raw IndexedDB helpers (independent of the module under test) ─────────────

/** Open the database exactly as the layout from before this seam existed. */
function rawOpen(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open("collab-media-pending", 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains("pending")) {
                req.result.createObjectStore("pending", { keyPath: "pendingId" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function rawPut(row: StoredPendingMedia): Promise<void> {
    const db = await rawOpen();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("pending", "readwrite");
        tx.objectStore("pending").put(row);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

async function rawGet(pendingId: string): Promise<Record<string, unknown> | undefined> {
    const db = await rawOpen();
    const row = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const req = db.transaction("pending", "readonly").objectStore("pending").get(pendingId);
        req.onsuccess = () => resolve(req.result as Record<string, unknown> | undefined);
        req.onerror = () => reject(req.error);
    });
    db.close();
    return row;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FK = "_default:s1:i1";
/** The first bytes of a real jpeg: the store decides by these, never by the declared type. */
const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ascii = (t: string): number[] => [...t].map((c) => c.charCodeAt(0));
const HEIC_HEAD = new Uint8Array([0, 0, 0, 24, ...ascii("ftyp"), ...ascii("heic"), 0, 0, 0, 0, ...ascii("mif1")]);
const AVIF_HEAD = new Uint8Array([0, 0, 0, 24, ...ascii("ftyp"), ...ascii("avif"), 0, 0, 0, 0, ...ascii("mif1")]);
const TEXT_BYTES = new TextEncoder().encode("this is plain text, not a picture");

function photoOf(pendingId: string, blob: Blob): PendingMediaRecord {
    return { kind: "photo", pendingId, inspectionId: "insp-v", createdAt: 1, blob, meta: { targetType: "item", findingKey: FK, itemId: "i1" } };
}
const crop = { aspect: "3:2", orientation: "landscape" as const, x: 1, y: 2, width: 30, height: 20 };

function photo(pendingId: string, inspectionId = "insp-1", createdAt = 1): PendingMediaRecord {
    return {
        kind: "photo", pendingId, inspectionId, createdAt,
        blob: new Blob([JPEG_HEAD, pendingId], { type: "image/jpeg" }),
        meta: { targetType: "item", findingKey: FK, itemId: "i1" },
    };
}

beforeEach(async () => {
    for (const r of await webMediaStore.list()) await webMediaStore.delete(r.pendingId);
});

// ─── On-disk layout ───────────────────────────────────────────────────────────

describe("web media store: frozen on-disk layout", () => {
    it("exports the layout constants this release shipped with", () => {
        expect(WEB_MEDIA_DB_NAME).toBe("collab-media-pending");
        expect(WEB_MEDIA_DB_VERSION).toBe(1);
        expect(WEB_MEDIA_STORE_NAME).toBe("pending");
        expect(WEB_MEDIA_KEY_PATH).toBe("pendingId");
    });

    it("the database it creates is named, versioned and keyed that way (raw inspection)", async () => {
        await webMediaStore.put(photo("layout-1"));
        const db = await rawOpen();
        expect(db.name).toBe("collab-media-pending");
        expect(db.version).toBe(1);
        expect([...db.objectStoreNames]).toEqual(["pending"]);
        expect(db.transaction("pending").objectStore("pending").keyPath).toBe("pendingId");
        db.close();
    });

    it("stores the legacy flat row, not the contract shape", async () => {
        await webMediaStore.put({
            kind: "crop", pendingId: "shape-1", inspectionId: "insp-1", createdAt: 77,
            blob: new Blob(["c"]),
            meta: { findingKey: FK, itemId: "i1", photoIndex: 3, photoKey: "r2/base.jpg", crop, sectionId: "s1" },
        });
        const row = await rawGet("shape-1");
        expect(row).toMatchObject({
            pendingId: "shape-1", inspectionId: "insp-1", findingKey: FK, kind: "crop",
            photoKey: "r2/base.jpg", crop, enqueuedAt: 77,
        });
        expect(row).not.toHaveProperty("meta");
        expect(row).not.toHaveProperty("createdAt");
    });
});

// ─── Rows written before this seam existed still load ─────────────────────────

describe("web media store: reads rows written by the previous implementation", () => {
    it("loads a legacy photo row as a contract photo record", async () => {
        await rawPut({ pendingId: "old-photo", inspectionId: "insp-9", findingKey: "_default:s1:i1", kind: "photo", blob: new Blob(["p"]), enqueuedAt: 5 });
        const rec = await webMediaStore.get("old-photo");
        expect(rec).toMatchObject({
            kind: "photo", pendingId: "old-photo", inspectionId: "insp-9", createdAt: 5,
            meta: { targetType: "item", findingKey: "_default:s1:i1", itemId: "i1" },
        });
    });

    it("loads legacy crop and annotate rows, deriving item and section from the finding key", async () => {
        await rawPut({ pendingId: "old-crop", inspectionId: "insp-9", findingKey: "unit-2:s7:i9", kind: "crop", blob: new Blob(["c"]), photoKey: "r2/b.jpg", crop, enqueuedAt: 6 });
        await rawPut({ pendingId: "old-anno", inspectionId: "insp-9", findingKey: "_default:s1:i1", kind: "annotate", blob: new Blob(["a"]), photoKey: "r2/b.jpg", nodesJson: "[]", enqueuedAt: 7 });
        const c = await webMediaStore.get("old-crop");
        const a = await webMediaStore.get("old-anno");
        expect(c).toMatchObject({ kind: "crop", meta: { findingKey: "unit-2:s7:i9", itemId: "i9", sectionId: "s7", photoKey: "r2/b.jpg", crop } });
        expect(a).toMatchObject({ kind: "annotate", meta: { itemId: "i1", sectionId: "s1", photoKey: "r2/b.jpg", nodesJson: "[]" } });
    });

    it("a legacy derivative row missing its fields still loads (it stays queued, it is not dropped)", async () => {
        await rawPut({ pendingId: "thin", inspectionId: "insp-9", findingKey: FK, kind: "crop", blob: new Blob(["c"]), enqueuedAt: 1 });
        const rec = await webMediaStore.get("thin");
        expect(rec?.kind).toBe("crop");
        if (rec?.kind === "crop") expect(rec.meta.photoKey).toBe("");
    });

    it("ignores rows that are not well-formed instead of throwing", async () => {
        const db = await rawOpen();
        await new Promise<void>((resolve) => {
            const tx = db.transaction("pending", "readwrite");
            tx.objectStore("pending").put({ pendingId: "junk", inspectionId: 4 });
            tx.oncomplete = () => resolve();
        });
        db.close();
        expect(await webMediaStore.get("junk")).toBeNull();
        expect((await webMediaStore.list()).map((r) => r.pendingId)).not.toContain("junk");
    });
});

// ─── Store behaviour ──────────────────────────────────────────────────────────

describe("web media store: PendingMediaStore behaviour", () => {
    it("put then get round-trips a contract record", async () => {
        await webMediaStore.put(photo("rt-1"));
        const read = await webMediaStore.get("rt-1");
        expect(read).toMatchObject({ kind: "photo", pendingId: "rt-1", meta: { findingKey: FK, itemId: "i1" } });
        expect(read?.blob).toBeDefined();
    });

    it("toStored and fromStored are inverses for every kind (photoIndex is not stored)", () => {
        const recs: PendingMediaRecord[] = [
            photo("a"),
            { kind: "crop", pendingId: "b", inspectionId: "i", createdAt: 2, blob: new Blob(["b"]), meta: { findingKey: FK, itemId: "i1", photoIndex: -1, photoKey: "k", crop, sectionId: "s1" } },
            { kind: "annotate", pendingId: "c", inspectionId: "i", createdAt: 3, blob: new Blob(["c"]), meta: { findingKey: FK, itemId: "i1", photoIndex: -1, photoKey: "k", nodesJson: "[1]", sectionId: "s1" } },
        ];
        for (const rec of recs) expect(fromStored(toStored(rec))).toEqual(rec);
    });

    it("get resolves null for an absent id", async () => {
        expect(await webMediaStore.get("does-not-exist")).toBeNull();
    });

    it("list filters by inspection and sorts oldest-first", async () => {
        await webMediaStore.put(photo("a30", "A", 30));
        await webMediaStore.put(photo("a10", "A", 10));
        await webMediaStore.put(photo("b20", "B", 20));
        expect((await webMediaStore.list("A")).map((r) => r.createdAt)).toEqual([10, 30]);
        expect(await webMediaStore.list()).toHaveLength(3);
    });

    it("delete removes a record and is safe for an absent one", async () => {
        await webMediaStore.put(photo("del-1"));
        await webMediaStore.delete("del-1");
        expect(await webMediaStore.get("del-1")).toBeNull();
        await expect(webMediaStore.delete("never-there")).resolves.toBeUndefined();
    });

    it("put rejects for a defect photo, which the stored shape cannot address", async () => {
        const rec: PendingMediaRecord = {
            kind: "photo", pendingId: "defect-1", inspectionId: "i", createdAt: 1, blob: new Blob([JPEG_HEAD]),
            meta: { targetType: "defect", findingKey: FK, itemId: "i1", customId: "c1", defectKind: "custom" },
        };
        await expect(webMediaStore.put(rec)).rejects.toThrow("defect");
        expect(await webMediaStore.get("defect-1")).toBeNull();
    });

    it("objectUrl is null for an absent record", async () => {
        expect(await webMediaStore.objectUrl("nope")).toBeNull();
    });
});

describe("web media store: put refuses a photo the server would permanently refuse", () => {
    const rejection = async (rec: PendingMediaRecord) => {
        try {
            await webMediaStore.put(rec);
        } catch (error) {
            return error as { code?: string };
        }
        return null;
    };

    it("a text file named photo.jpg and declared image/jpeg is refused with UNSUPPORTED_TYPE and stores nothing", async () => {
        const file = new File([TEXT_BYTES], "photo.jpg", { type: "image/jpeg" });
        expect((await rejection(photoOf("txt-1", file)))?.code).toBe("UNSUPPORTED_TYPE");
        expect(await webMediaStore.get("txt-1")).toBeNull();
        expect(await webMediaStore.list("insp-v")).toEqual([]);
    });

    it.each([["jpeg", JPEG_HEAD], ["png", PNG_HEAD], ["heic", HEIC_HEAD]] as const)("CONTROL - real %s bytes are stored, whatever they are declared as", async (name, head) => {
        for (const type of ["", "application/octet-stream", "text/plain"]) {
            const id = `ok-${name}-${type.length}`;
            await webMediaStore.put(photoOf(id, new File([head], "x.bin", { type })));
            expect(await webMediaStore.get(id), id).not.toBeNull();
        }
    });

    it("AVIF and an empty body are refused: the server stores neither", async () => {
        expect((await rejection(photoOf("avif-1", new Blob([AVIF_HEAD], { type: "image/jpeg" }))))?.code).toBe("UNSUPPORTED_TYPE");
        expect((await rejection(photoOf("empty-1", new Blob([], { type: "image/jpeg" }))))?.code).toBe("UNSUPPORTED_TYPE");
        expect(await webMediaStore.list("insp-v")).toEqual([]);
    });

    it("one byte over the server's photo ceiling is refused with TOO_LARGE; exactly the ceiling is stored", async () => {
        const over = new Blob([JPEG_HEAD, new Uint8Array(MAX_PHOTO_BYTES + 1 - JPEG_HEAD.length)]);
        expect(over.size).toBe(MAX_PHOTO_BYTES + 1);
        expect((await rejection(photoOf("big-1", over)))?.code).toBe("TOO_LARGE");
        expect(await webMediaStore.get("big-1")).toBeNull();
        const exact = new Blob([JPEG_HEAD, new Uint8Array(MAX_PHOTO_BYTES - JPEG_HEAD.length)]);
        expect(exact.size).toBe(MAX_PHOTO_BYTES);
        await webMediaStore.put(photoOf("big-2", exact));
        expect(await webMediaStore.get("big-2")).not.toBeNull();
    });

    it("the admission check runs before the record is converted: a refused defect photo is reported by its specific reason, and a valid one still hits the conversion error", async () => {
        const defectRec = (id: string, blob: Blob): PendingMediaRecord => ({
            kind: "photo", pendingId: id, inspectionId: "insp-v", createdAt: 1, blob,
            meta: { targetType: "defect", findingKey: FK, itemId: "i1", customId: "c1", defectKind: "custom" },
        });
        // Conversion would throw a non-coded error for any defect photo; the over-limit and non-image ones must win with their code.
        expect((await rejection(defectRec("d-big", new Blob([JPEG_HEAD, new Uint8Array(MAX_PHOTO_BYTES)]))))?.code).toBe("TOO_LARGE");
        expect((await rejection(defectRec("d-txt", new Blob([TEXT_BYTES]))))?.code).toBe("UNSUPPORTED_TYPE");
        // CONTROL: an admissible defect photo reaches the conversion and fails there without a reason code.
        const converted = await rejection(defectRec("d-ok", new Blob([JPEG_HEAD])));
        expect(converted).toBeInstanceOf(Error);
        expect(converted?.code).toBeUndefined();
        expect(await webMediaStore.list("insp-v")).toEqual([]);
    });

    it("the web store applies the SERVER's rules: the same ceiling and the same sniffer (executable coupling)", async () => {
        expect(MAX_PHOTO_BYTES).toBe(10 * 1024 * 1024);
        // The sniffer the store reads is the server's: what it accepts, the server stores.
        for (const head of [JPEG_HEAD, PNG_HEAD, HEIC_HEAD]) expect(sniffPhotoType(head)).not.toBeNull();
        for (const head of [AVIF_HEAD, TEXT_BYTES]) expect(sniffPhotoType(head)).toBeNull();
        const bigServerLimit = new Blob([JPEG_HEAD, new Uint8Array(MAX_PHOTO_BYTES - JPEG_HEAD.length + 1)]);
        expect((await rejection(photoOf("couple-1", bigServerLimit)))?.code).toBe("TOO_LARGE");
    });

    it("an offline batch through the real batch path: rejected files get the fixed reasons and the stored count is kept", async () => {
        const doc = new Y.Doc();
        seedResultsDoc(doc, [{ findingKey: FK }]);
        const big = new Blob([JPEG_HEAD, new Uint8Array(MAX_PHOTO_BYTES)], { type: "image/jpeg" });
        const files = [
            new File([JPEG_HEAD, "a"], "ok.jpg", { type: "image/jpeg" }),
            new File([TEXT_BYTES], "fake.jpg", { type: "image/jpeg" }),
            big,
            new File([HEIC_HEAD], "phone.heic", { type: "" }),
        ];
        const result = await addOfflinePhotos(webMediaStore, doc, { inspectionId: "insp-b", findingKey: FK, itemId: "i1", source: "library" }, files);
        expect(result).toEqual({ rejected: 2, reasons: { unsupportedType: 1, tooLarge: 1 } });
        const entries = (projectResults(doc)[FK]?.photos ?? []) as unknown[];
        expect(entries).toHaveLength(2);
        expect(await webMediaStore.list("insp-b")).toHaveLength(2);
        expect(offlinePhotoRejectionMessages(result, files.length).length).toBe(3); // summary + one sentence per reason
    });
});
