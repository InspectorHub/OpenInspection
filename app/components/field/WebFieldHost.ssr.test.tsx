// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { useFieldDataSource } from "@core/field-ui/context";
import { loaderPayload } from "~/lib/field/web-editor-data.fixtures";
import { WebFieldHost } from "./WebFieldHost";

function Show() {
    const ds = useFieldDataSource();
    return <p>{`${ds.session().tenantSlug}|${ds.isOnline()}|${ds.urls.photo("i", "k")}`}</p>;
}

describe("WebFieldHost on the server", () => {
    it("renders with no window, navigator.onLine or indexedDB", () => {
        expect(typeof window).toBe("undefined");
        expect(typeof indexedDB).toBe("undefined");
        const Stub = createRoutesStub([
            { path: "/", Component: () => <WebFieldHost editor={loaderPayload({ tenantSlug: "acme" })}><Show /></WebFieldHost> },
        ]);
        const html = renderToString(<Stub initialEntries={["/"]} />);
        expect(html).toContain("acme|true|/api/inspections/i/photo?key=k");
    });
});
