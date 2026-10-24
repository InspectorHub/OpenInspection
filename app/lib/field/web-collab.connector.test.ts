// @vitest-environment happy-dom
/**
 * The web `collab` connector over a stubbed `connectResultsDoc`: it must hand the host pieces to the
 * connection, expose the LIVE document (a version restore replaces it), keep `synced` live, settle
 * `persistenceSynced` once, and pass the callbacks through.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { ConnectOptions, ResultsDocHandle } from "@core/field-ui/collab/results-doc-connection";

const connection = vi.hoisted(() => ({
    opts: null as null | ConnectOptions,
    handle: null as null | ResultsDocHandle,
    destroy: vi.fn(),
    connectArgs: [] as string[],
}));

vi.mock("@core/field-ui/collab/results-doc-connection", async (importOriginal) => {
    const original = await importOriginal<typeof import("@core/field-ui/collab/results-doc-connection")>();
    return {
        ...original,
        connectResultsDoc: (inspectionId: string, opts: ConnectOptions) => {
            connection.connectArgs.push(inspectionId);
            connection.opts = opts;
            connection.handle = { doc: new Y.Doc(), persistenceSynced: false, synced: false };
            return { handle: connection.handle, destroy: connection.destroy };
        },
    };
});

import { webCollabConnector, webCollabHost } from "./web-collab";

beforeEach(() => {
    connection.destroy.mockClear();
    connection.connectArgs.length = 0;
});

describe("webCollabConnector", () => {
    it("connects with this host's persistence, socket url and online signal", () => {
        webCollabConnector.connect("insp-1", {});
        expect(connection.connectArgs).toEqual(["insp-1"]);
        expect(connection.opts?.persistence).toBe(webCollabHost.persistence);
        expect(connection.opts?.wsUrl).toBe(webCollabHost.wsUrl);
        expect(connection.opts?.subscribeOnline).toBe(webCollabHost.subscribeOnline);
    });

    it("reads the document and the synced flag live, through a restore that replaces them", () => {
        const live = webCollabConnector.connect("insp-1", {});
        const first = live.doc;
        expect(first).toBe(connection.handle!.doc);
        expect(live.synced()).toBe(false);
        connection.handle!.synced = true;
        expect(live.synced()).toBe(true);
        const fresh = new Y.Doc();
        connection.handle!.doc = fresh;
        expect(live.doc).toBe(fresh);
        expect(live.doc).not.toBe(first);
    });

    it("settles persistenceSynced only once the store has applied its state, and reports each change", async () => {
        const onChange = vi.fn();
        const live = webCollabConnector.connect("insp-1", { onChange });
        let settled = false;
        void live.persistenceSynced.then(() => {
            settled = true;
        });
        connection.opts!.onChange!({ ...connection.handle!, persistenceSynced: false });
        await Promise.resolve();
        expect(settled).toBe(false);
        connection.opts!.onChange!({ ...connection.handle!, persistenceSynced: true });
        await live.persistenceSynced;
        expect(settled).toBe(true);
        expect(onChange).toHaveBeenCalledTimes(2);
    });

    it("passes onSynced through and destroys the connection", () => {
        const onSynced = vi.fn();
        const live = webCollabConnector.connect("insp-1", { onSynced });
        connection.opts!.onSynced!();
        expect(onSynced).toHaveBeenCalledTimes(1);
        live.destroy();
        expect(connection.destroy).toHaveBeenCalledTimes(1);
    });
});
