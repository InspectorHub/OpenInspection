import type { CollabConnector, EditorData, FieldDataSource, SessionInfo } from "@core/field-ui/data-source";
import type { MediaUploader } from "@core/field-ui/media-types";
import { webMediaStore } from "./web-media-store";
import { webSessionInfo, type SessionContextLike, type SessionLoaderBits } from "./web-session";
import { createWebUrls } from "./web-urls";
import { webIsOnline, webNotify, webOnOnlineChange } from "./web-env";
import { createWebExecute, type WebExecute } from "./web-transport";
import { createWebPrefs } from "./web-prefs";

/**
 * What the composed data source reads and calls. Every member is a function, so the host can
 * keep the volatile values (loader data, router handles, session context) behind refs and the
 * data source itself never changes identity.
 */
export interface WebDataSourceParts {
    /** The editor's loader payload, converted; null on a host that has no inspection (template-edit). */
    current: () => EditorData | null;
    sessionBits: () => SessionLoaderBits;
    sessionContext: () => SessionContextLike | null;
    reload: () => void;
    exit: () => void;
    /** Override for tests; defaults to the BFF resource-route transport. */
    transport?: WebExecute;
}

const NO_INSPECTION = "This host has no inspection to read or write.";

const notWired = (what: string) =>
    `${what} is not wired to the web data source yet; the editor still uses its own path for it.`;

const collab: CollabConnector = {
    connect() {
        throw new Error(notWired("Collaborative editing"));
    },
    purge() {
        return Promise.reject(new Error(notWired("Offline purge")));
    },
};

function uploader(): MediaUploader {
    return {
        upload() {
            return Promise.reject(new Error(notWired("Media upload")));
        },
    };
}

/**
 * Compose the web `FieldDataSource`. Nothing browser-only is touched here: the media store opens
 * IndexedDB on first use, `createWebUrls` reads `window` only inside `presenceSocket`, and the
 * online helpers guard themselves.
 */
export function createWebFieldDataSource(parts: WebDataSourceParts): FieldDataSource {
    const realExecute = parts.transport ?? createWebExecute();
    const execute: WebExecute = (inspectionId, cmd, opts) => {
        if (parts.current() === null) {
            return Promise.reject(new Error(`${NO_INSPECTION} Command "${cmd.type}" was not sent.`));
        }
        return realExecute(inspectionId, cmd, opts);
    };
    return {
        async load(inspectionId, scope) {
            const current = parts.current();
            if (current === null) throw new Error(`${NO_INSPECTION} Nothing to load.`);
            if (scope === undefined) return current;
            const res = await realExecute(inspectionId, { type: "load-scope", scope });
            if (!res.ok) throw new Error(res.error ?? "Could not load this scope.");
            if (!res.data) throw new Error("The scope answer carried no results.");
            return { ...current, results: res.data.results };
        },
        session: (): SessionInfo => webSessionInfo(parts.sessionContext(), parts.sessionBits()),
        execute,
        notify: (message, variant) => webNotify(message, variant),
        reload: () => parts.reload(),
        exit: () => parts.exit(),
        isOnline: webIsOnline,
        onOnlineChange: webOnOnlineChange,
        collab,
        media: { store: webMediaStore, uploader },
        urls: createWebUrls(),
        resources: { prefs: createWebPrefs() },
        platform: "web",
    };
}
