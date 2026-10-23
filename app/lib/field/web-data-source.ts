import type { EditorData, FieldDataSource, SessionInfo } from "@core/field-ui/data-source";
import { createWebMediaUploader } from "./web-uploader";
import { webMediaStore } from "./web-media-store";
import { webCollabConnector } from "./web-collab";
import { webSessionInfo, type SessionContextLike, type SessionLoaderBits } from "./web-session";
import { createWebUrls } from "./web-urls";
import { webIsOnline, webNotify, webOnOnlineChange } from "./web-env";
import { createWebExecute, type WebExecute } from "./web-transport";
import { createWebAiAssist } from "./web-ai-assist";
import { createWebCommentsLibrary } from "./web-comments-library";
import { createWebCostItems } from "./web-cost-items";
import { createWebPrefs } from "./web-prefs";
import { createWebPublishReadiness } from "./web-publish-readiness";
import { createWebVideo } from "./web-video";
import { createWebMediaPool } from "./web-media-pool";
import { createWebRepairItems } from "./web-repair-items";
import { createWebSettingsSheet } from "./web-settings-sheet";
import { createWebTemplateSearch } from "./web-template-search";
import { createWebVersionHistory } from "./web-version-history";

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
        notify: (message, variant, opts) => webNotify(message, variant, undefined, opts),
        reload: () => parts.reload(),
        // A template change needs a fresh mount (the editor freezes its schema and seeds the collab document
        // from it), which a loader revalidation does not give.
        restartSession: () => window.location.reload(),
        openUrl: (url) => {
            window.open(url, "_blank", "noopener");
        },
        exit: () => parts.exit(),
        isOnline: webIsOnline,
        onOnlineChange: webOnOnlineChange,
        collab: webCollabConnector,
        media: { store: webMediaStore, uploader: createWebMediaUploader },
        urls: createWebUrls(),
        resources: {
            prefs: createWebPrefs(),
            video: createWebVideo(),
            commentsLibrary: createWebCommentsLibrary(),
            costItems: createWebCostItems(),
            aiAssist: createWebAiAssist(),
            templateSearch: createWebTemplateSearch(),
            repairItems: createWebRepairItems(),
            mediaPool: createWebMediaPool(),
            settingsSheet: createWebSettingsSheet(),
            versionHistory: createWebVersionHistory(),
            publishReadiness: createWebPublishReadiness(),
        },
        platform: "web",
    };
}
