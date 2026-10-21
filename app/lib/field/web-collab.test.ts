// @vitest-environment happy-dom
/**
 * The web host for the field-ui collab connection. The expected strings below
 * are what the pre-seam `buildCollabWsUrl` / `results-<id>` database naming
 * produced, so a change here would orphan existing offline data or break the
 * collab URL.
 */
import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
    buildCollabWsUrl,
    webClearResultsData,
    webCollabWsUrl,
    webOfflinePurgeHost,
    webPersistence,
    webSubscribeOnline,
} from "./web-collab";

async function dbNames(): Promise<string[]> {
    return (await indexedDB.databases()).map((d) => d.name ?? "");
}

describe("buildCollabWsUrl", () => {
    it("returns wss:// for https: and encodes the id", () => {
        expect(buildCollabWsUrl("insp-123", { protocol: "https:", host: "example.com" }))
            .toBe("wss://example.com/api/inspections/insp-123/collab/ws");
    });
    it("returns ws:// for http:", () => {
        expect(buildCollabWsUrl("insp-abc", { protocol: "http:", host: "localhost:8788" }))
            .toBe("ws://localhost:8788/api/inspections/insp-abc/collab/ws");
    });
    it("percent-encodes ids containing special characters", () => {
        const id = "insp/with spaces&more";
        expect(buildCollabWsUrl(id, { protocol: "https:", host: "example.com" }))
            .toBe(`wss://example.com/api/inspections/${encodeURIComponent(id)}/collab/ws`);
    });
});

describe("webCollabWsUrl", () => {
    it("uses the page origin (happy-dom serves http, so ws://)", () => {
        const { protocol, host } = window.location;
        expect(protocol).toBe("http:");
        expect(webCollabWsUrl("insp-9")).toBe(`ws://${host}/api/inspections/insp-9/collab/ws`);
    });
});

describe("webPersistence", () => {
    it("stores under the given name verbatim and clearData deletes just that database", async () => {
        const keep = webPersistence("results-keep-me", new Y.Doc());
        const drop = webPersistence("results-drop-me", new Y.Doc());
        await keep.whenSynced;
        await drop.whenSynced;
        expect(await dbNames()).toEqual(expect.arrayContaining(["results-keep-me", "results-drop-me"]));

        await drop.destroy();
        await drop.clearData?.();
        const after = await dbNames();
        expect(after).not.toContain("results-drop-me");
        expect(after).toContain("results-keep-me");
        await keep.destroy();
    });
});

describe("webClearResultsData / webOfflinePurgeHost", () => {
    it("deletes results-<id>", async () => {
        const store = webPersistence("results-purge-1", new Y.Doc());
        await store.whenSynced;
        await store.destroy();
        expect(await dbNames()).toContain("results-purge-1");
        await webClearResultsData("purge-1");
        expect(await dbNames()).not.toContain("results-purge-1");
    });
    it("reports a local store as available where indexedDB exists", () => {
        expect(webOfflinePurgeHost.available()).toBe(true);
    });
});

describe("webSubscribeOnline", () => {
    it("fires on the window online event and stops after unsubscribe", () => {
        let calls = 0;
        const off = webSubscribeOnline(() => { calls += 1; });
        window.dispatchEvent(new Event("online"));
        expect(calls).toBe(1);
        off();
        window.dispatchEvent(new Event("online"));
        expect(calls).toBe(1);
    });
});
