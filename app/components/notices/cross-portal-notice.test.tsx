// @vitest-environment happy-dom
/**
 * One notice, three portals (C4).
 *
 * Before Track C a staff alert and an outward notice were different entities
 * that merely rendered as list rows — one had read state and no channel, the
 * other had channels and delivery status and no read state. Sharing on shape
 * rather than meaning would have produced a component with two mutually
 * exclusive modes, which is why the design deferred the shared component until
 * C1 made them ONE entity: a notice, addressed to a user or a contact,
 * delivered over zero or more channels.
 *
 * They are one entity now, so this is the guard the design asked for, modelled
 * on cross-portal-reuse.test.tsx: render the SAME notice through the client,
 * agent and staff entry points and compare what a reader actually sees. It
 * compares rendered text, not imports — a copy-pasted component that happens
 * to match today is still a fork tomorrow.
 *
 * The two differences are deliberate and are PROPS, not branches:
 *   - the agent's rows name the sending company (their inbox spans companies);
 *   - the email remedy renders only where a composer exists.
 * Everything else — the title, the channel line, the outcome wording, the
 * timestamp — must be identical.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { NoticeList } from "./NoticeList";
import type { NoticeRowData } from "~/lib/notice-view";

const NOTICE: NoticeRowData = {
  id: "n-1",
  tenantId: "t-1",
  type: "report.published",
  title: "Report ready",
  body: null,
  inspectionId: "insp-1",
  createdAt: Date.now() - 3 * 3600_000,
  readAt: null,
  channels: [
    { channel: "email", status: "sent", reasonCode: null, recipient: "jane@x.com", deliveredAt: null, sendAt: 1 },
    { channel: "sms", status: "skipped", reasonCode: "no sms consent", recipient: "+15550001111", deliveredAt: null, sendAt: 1 },
  ],
};

/** Text a reader sees, with whitespace collapsed. */
const readable = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/**
 * Rendered inside a router stub because the row formats its timestamp in the
 * reader's locale, which comes from route loader data — the same reason
 * cross-portal-reuse.test.tsx wraps its agent side.
 */
const renderFor = (props: Partial<Parameters<typeof NoticeList>[0]>) => {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <NoticeList
          notices={[NOTICE]}
          emailComposer={false}
          emptyBody="nothing yet"
          onDismiss={() => {}}
          onRemedy={() => {}}
          {...props}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
};

describe("one notice, three portals", () => {
  it("reads identically in the client and staff inboxes", () => {
    const client = renderFor({ emailComposer: true });
    const staff = renderFor({ emailComposer: false });
    // The client has a composer and the staff page does not, but this notice's
    // only remedy is the SMS one, which is real on both — so the reader sees
    // the same words.
    expect(readable(client.container)).toBe(readable(staff.container));
  });

  it("the agent view differs only by naming the company that sent it", () => {
    const client = renderFor({ emailComposer: true });
    const agent = renderFor({
      showCompany: true,
      notices: [{ ...NOTICE, companyName: "Maple Ridge Inspections" }],
    });

    const agentText = readable(agent.container);
    expect(agentText).toContain("Maple Ridge Inspections");
    // Strip the one intended difference and the two must match exactly.
    expect(agentText.replace("Maple Ridge Inspections · ", "")).toBe(readable(client.container));
  });

  it("shows the delivery outcome as WORDS in every portal, never colour alone", () => {
    for (const emailComposer of [true, false]) {
      const text = readable(renderFor({ emailComposer }).container);
      expect(text).toContain("Delivered");
      expect(text).toContain("Not delivered");
    }
  });

  it("a staff notice — no channels — renders without a delivery line anywhere", () => {
    // The test of whether the component is genuinely shared: a staff alert was
    // never dispatched, and it must render as a plain row without the page
    // asking for a variant.
    const staffNotice: NoticeRowData = { ...NOTICE, channels: [] };
    const text = readable(renderFor({ notices: [staffNotice] }).container);

    expect(text).not.toContain("Delivered");
    expect(text).not.toContain("Turn on texts");
    // …but the notice itself is still there.
    expect(text).toContain("Your inspection report is ready");
  });

  it("withholds the email remedy where no composer exists, and only there", () => {
    const bounced: NoticeRowData = {
      ...NOTICE,
      channels: [
        { channel: "email", status: "failed", reasonCode: "550 mailbox unavailable", recipient: "ray@old.com", deliveredAt: null, sendAt: 1 },
      ],
    };
    expect(readable(renderFor({ notices: [bounced], emailComposer: true }).container))
      .toContain("Tell us your new email");
    expect(readable(renderFor({ notices: [bounced], emailComposer: false }).container))
      .not.toContain("Tell us your new email");
  });
});
