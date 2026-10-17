// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { render, cleanup } from "@testing-library/react";
import { IcsSubscribePanel } from "~/components/settings/IcsSubscribePanel";
import { ScheduleLinksPanel } from "~/components/settings/ScheduleLinksPanel";
import { CompanyBookingLinksPanel } from "~/components/settings/CompanyBookingLinksPanel";
import { EmbedWidgetPanel } from "~/components/settings/EmbedWidgetPanel";
import { usePageOrigin } from "~/hooks/usePageOrigin";

afterEach(cleanup);

function Probe() {
    return <span data-testid="o">{usePageOrigin()}</span>;
}

describe("the page origin never disagrees with the server's HTML", () => {
    it("is empty in server-rendered markup even where a window exists, and real after the client renders", () => {
        expect(renderToString(<Probe />)).toContain("></span>");
        const { getByTestId } = render(<Probe />);
        expect(getByTestId("o").textContent).toBe(window.location.origin);
    });

    // Each panel prints a link built on the origin. The server markup must carry none of it, or the client's
    // first render differs from the page it hydrates.
    it.each([
        ["ICS feeds", <IcsSubscribePanel key="a" links={{ companyPath: "/api/ics/company/x", busyPath: "/api/ics/busy/x", schedulePath: null }} />],
        ["schedule links", <ScheduleLinksPanel key="b" tenant="acme" slug="pat" />],
        ["company booking links", <CompanyBookingLinksPanel key="c" tenant="acme" />],
        ["embed widget", <EmbedWidgetPanel key="d" tenant="acme" />],
    ])("%s: server markup has no origin in it", (_name, ui) => {
        expect(renderToString(ui)).not.toContain(window.location.origin);
    });

    it("control: the same panel on the client does print the origin", () => {
        const { container } = render(<ScheduleLinksPanel tenant="acme" slug="pat" />);
        expect(container.textContent).toContain(`${window.location.origin}/book/acme/pat`);
    });
});
