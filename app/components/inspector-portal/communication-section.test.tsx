// @vitest-environment happy-dom
/**
 * <CommunicationSection> invariants (plan A1.5).
 *
 * The one the earlier merged draft lost, asserted on RENDERED OUTPUT rather
 * than props: a delivery row never renders inside Messages and a message never
 * renders inside the Outbox. Plus: a failure auto-expands the Outbox, the
 * three Outbox empty states are DISTINCT (they look identical and mean
 * opposite things), and a skipped row renders mapped copy — never the raw
 * machine string.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { CommunicationSection, type CommunicationCounts } from "./CommunicationSection";
import type { CommunicationPayload } from "~/routes/resources/inspection-communication";

const COUNTS_CLEAN: CommunicationCounts = { delivered: 4, needsAttention: 0, unread: 0, rulesActive: 2 };

const PAYLOAD: CommunicationPayload = {
  messages: [
    {
      id: "m1", direction: "in", contactId: "c1", fromRole: "client",
      fromName: "Dana Client", body: "Is the roof repair urgent?",
      attachments: [], createdAt: Date.UTC(2026, 6, 29, 15),
    },
  ],
  deliveries: [
    {
      id: "d1", channel: "sms", recipient: "+15550001111", recipientContactId: "c1",
      roleKey: "client", roleLabel: "Client", status: "skipped",
      reasonCode: "no sms consent", source: "automation",
      automationId: "a1", automationName: "Report ready", noticeId: null,
      sendAt: Date.UTC(2026, 6, 29, 14), deliveredAt: null,
    },
  ],
  reportLinks: [],
};

function renderSection(counts: CommunicationCounts, payload: CommunicationPayload, opts?: { rulesActive?: number; reportPublished?: boolean }) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <CommunicationSection
          inspectionId="insp-1"
          counts={counts}
          reportPublished={opts?.reportPublished ?? true}
          threadOptions={[{ contactId: "c1", name: "Dana Client", roleLabel: "Client" }]}
        />
      ),
    },
    {
      path: "/resources/inspection-communication",
      loader: () => payload,
      action: () => ({ ok: true }),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("CommunicationSection", () => {
  it("auto-expands the Outbox when something needs attention — a failure never hides behind a disclosure", async () => {
    const { findByText } = renderSection(
      { ...COUNTS_CLEAN, needsAttention: 1 },
      PAYLOAD,
    );
    // Without any click on the BLOCK, the notice row is already visible —
    // the block-level disclosure opened itself.
    const row = await findByText("Report ready");
    // The reason sits one level deeper, behind the row's own expand.
    fireEvent.click(row);
    await findByText(/hasn't agreed to receive texts/i);
  });

  it("never renders the raw reason string", async () => {
    const { findByText, queryByText } = renderSection({ ...COUNTS_CLEAN, needsAttention: 1 }, PAYLOAD);
    await findByText("Report ready");
    // Expand the notice to its recipient rows.
    fireEvent.click(await findByText("Report ready"));
    await waitFor(() => expect(queryByText("no sms consent")).toBeNull());
  });

  it("keeps messages and deliveries in their own blocks — never interleaved", async () => {
    const { findByText, getByText, container } = renderSection({ ...COUNTS_CLEAN, needsAttention: 1, unread: 1 }, PAYLOAD);
    // Open Messages too (Outbox is already auto-open).
    fireEvent.click(getByText("Messages"));
    await findByText("Is the roof repair urgent?");
    await findByText("Report ready");

    // Assert on the DOM: the chat bubble and the notice row never share a
    // common block container. The bubble lives under the Messages disclosure,
    // the notice under the Outbox one.
    const bubble = getByText("Is the roof repair urgent?");
    const notice = getByText("Report ready");
    const messagesBlock = bubble.closest("div.pb-3");
    expect(messagesBlock).not.toBeNull();
    expect(messagesBlock!.contains(notice)).toBe(false);
    expect(container.querySelectorAll("ul").length).toBeGreaterThan(0);
  });

  it("shows three DISTINCT Outbox empty states", async () => {
    const empty: CommunicationPayload = { messages: [], deliveries: [], reportLinks: [] };

    // ① No rules at all → point at Settings.
    const a = renderSection({ ...COUNTS_CLEAN, delivered: 0, rulesActive: 0 }, empty);
    fireEvent.click(a.getByText("Outbox"));
    await a.findByText(/no automation rules are turned on/i);
    a.unmount();

    // ② Rules exist, report unpublished → notices go out at publish.
    const b = renderSection({ ...COUNTS_CLEAN, delivered: 0 }, empty, { reportPublished: false });
    fireEvent.click(b.getByText("Outbox"));
    await b.findByText(/when the report is published/i);
    b.unmount();

    // ③ Rules exist, report published, nothing fired for this inspection.
    const c = renderSection({ ...COUNTS_CLEAN, delivered: 0 }, empty, { reportPublished: true });
    fireEvent.click(c.getByText("Outbox"));
    await c.findByText(/Nothing sent for this inspection yet/i);
  });

  it("Messages has its own empty state, separate from the Outbox's", async () => {
    const { getByText, findByText } = renderSection(COUNTS_CLEAN, { messages: [], deliveries: [], reportLinks: [] });
    fireEvent.click(getByText("Messages"));
    await findByText(/No messages yet/i);
  });
});
