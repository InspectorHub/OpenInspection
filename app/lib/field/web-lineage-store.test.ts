// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { readDiscardedStore, webLineageStore } from "./web-lineage-store";
import { webClearResultsData } from "./web-collab";

describe("webLineageStore", () => {
    it("reads null before anything is written, then the written generation", async () => {
        const store = webLineageStore("insp-a");
        expect(await store.read()).toBeNull();
        await store.write("gen-aaaaaaaa");
        expect(await store.read()).toBe("gen-aaaaaaaa");
        expect(await webLineageStore("insp-b").read()).toBeNull();
    });

    it("keeps ONE backup slot: the next discard overwrites the previous one", async () => {
        const store = webLineageStore("insp-slot");
        const one = new Y.Doc();
        one.getMap("results").set("a", 1);
        const two = new Y.Doc();
        two.getMap("results").set("b", 2);
        await store.saveDiscarded(Y.encodeStateAsUpdate(one), { storedGen: "gen-old-0001", serverGen: "gen-new-0002" });
        await store.saveDiscarded(Y.encodeStateAsUpdate(two), { storedGen: "gen-new-0002", serverGen: "gen-new-0003" });
        const slot = await readDiscardedStore("insp-slot");
        expect(slot?.storedGen).toBe("gen-new-0002");
        expect(slot?.serverGen).toBe("gen-new-0003");
        const copy = new Y.Doc();
        Y.applyUpdate(copy, slot?.update ?? new Uint8Array());
        expect(copy.getMap("results").get("b")).toBe(2);
        expect(copy.getMap("results").get("a")).toBeUndefined();
    });

    it("is erased with the rest of the inspection's offline data", async () => {
        const store = webLineageStore("insp-gone");
        await store.write("gen-aaaaaaaa");
        await store.saveDiscarded(new Uint8Array([0, 0]), { storedGen: "gen-aaaaaaaa", serverGen: "gen-bbbbbbbb" });
        await webClearResultsData("insp-gone");
        expect(await store.read()).toBeNull();
        expect(await readDiscardedStore("insp-gone")).toBeNull();
    });
});
