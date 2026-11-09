// @vitest-environment happy-dom
/**
 * Notice timestamps follow the UI language.
 *
 * `useDisplayLocale()` resolves the ACCOUNT locale (and "en-US" outside the auth
 * layout, which is where the agent portal lives), so an es-419 UI showed
 * "7 minutes ago". The language every other string on the page is in is the UI
 * locale cookie, read through paraglide's getLocale().
 */
import { describe, it, expect, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { overwriteGetLocale } from "~/paraglide/runtime";
import { NoticeList } from "~/components/notices/NoticeList";
import type { NoticeRowData } from "~/lib/notice-view";

const row: NoticeRowData = {
  id: "n1", type: "report.published", title: "x", body: null, inspectionId: null,
  createdAt: Date.now() - 7 * 60_000, readAt: null, channels: [],
};

function renderList() {
  const Stub = createRoutesStub([{
    path: "/",
    Component: () => <NoticeList notices={[row]} emailComposer={false} emptyBody="" onDismiss={() => {}} onRemedy={() => {}} />,
  }]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("NoticeList relative time", () => {
  afterEach(() => overwriteGetLocale(() => "en"));

  it("is Spanish under an es-419 UI even with no session context", async () => {
    overwriteGetLocale(() => "es-419");
    const { container, findByText } = renderList();
    await findByText(/hace|minutes/);
    expect(container.textContent).toMatch(/hace 7 minutos/);
    expect(container.textContent).not.toMatch(/minutes ago/);
  });

  it("is English under an en UI (the control)", async () => {
    overwriteGetLocale(() => "en");
    const { findByText } = renderList();
    expect(await findByText(/7 minutes ago/)).toBeTruthy();
  });
});
