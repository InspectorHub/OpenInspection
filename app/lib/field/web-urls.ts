import type { FieldUrls } from "@core/field-ui/data-source";
import { pathSegment } from "./url-segment";

/** Where the presence socket's origin comes from. Injected so the function is testable. */
export interface PresenceLocation {
    protocol: string;
    host: string;
}

/**
 * The web host's `FieldUrls`: relative strings byte-identical to the ones the call
 * sites build today (see `web-urls.test.ts`, which pins them and greps the call sites).
 *
 * Pure: nothing is read at construction. `presenceSocket` reads `window.location` only
 * inside its own body, only when no location was injected, and throws a clear error on
 * the server rather than guessing a host.
 */
export function createWebUrls(location?: PresenceLocation): FieldUrls {
    return {
        photo: (inspectionId, key) => `/api/inspections/${pathSegment(inspectionId)}/photo?key=${encodeURIComponent(key)}`,
        reportPreview: (tenantSlug, inspectionId) =>
            tenantSlug ? `/report-view/${pathSegment(tenantSlug)}/${pathSegment(inspectionId)}` : null,
        reportPdf: (inspectionId) => `/api/inspections/${pathSegment(inspectionId)}/pdf?type=full`,
        costExport: (inspectionId, format) =>
            `/resources/cost-export?inspectionId=${encodeURIComponent(inspectionId)}&format=${format}`,
        statutoryPreviewPdf: (inspectionId) => `/api/inspections/${pathSegment(inspectionId)}/statutory-form/preview.pdf`,
        videoObject: (inspectionId, ref) =>
            ref ? `/api/inspections/${pathSegment(inspectionId)}/media/video/r2-object/${pathSegment(ref)}` : null,
        presenceSocket: (inspectionId) => {
            const loc = location ?? browserLocation();
            const scheme = loc.protocol === "https:" ? "wss:" : "ws:";
            return `${scheme}//${loc.host}/api/inspections/${pathSegment(inspectionId)}/presence/ws`;
        },
        editorPath: (inspectionId) => `/inspections/${pathSegment(inspectionId)}/edit`,
        inspectionsList: () => "/inspections",
    };
}

function browserLocation(): PresenceLocation {
    if (typeof window === "undefined") {
        throw new Error("presenceSocket needs a browser location; none is available on the server");
    }
    return { protocol: window.location.protocol, host: window.location.host };
}
