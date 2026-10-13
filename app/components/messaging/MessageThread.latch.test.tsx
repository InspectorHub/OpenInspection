// @vitest-environment happy-dom
// Two clicks dispatched in ONE act() reach onSend once. The `sending` state only lands after a
// render, which is too late for the second event.
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("~/hooks/useSessionContext", () => ({
  useDisplayTimeZone: () => "UTC",
  useDisplayLocale: () => "en-US",
}));

import { MessageThread } from "~/components/messaging/MessageThread";
import { m } from "~/paraglide/messages";

afterEach(cleanup);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

function setup(onSend: (body: string) => Promise<void>) {
  render(
    <MessageThread
      messages={[]}
      attachmentHref={(id) => `/a/${id}`}
      onSend={onSend}
      emptyTitle="Nothing"
      emptyBody="Empty"
    />,
  );
  const box = screen.getByPlaceholderText(m.portal_messages_compose_placeholder()) as HTMLTextAreaElement;
  const send = () => screen.getByRole("button", { name: m.portal_messages_send() }) as HTMLButtonElement;
  return { box, send };
}

describe("MessageThread same-frame latch", () => {
  it("sends ONCE for two clicks in one act, and again for a later message", async () => {
    const onSend = vi.fn(async () => {});
    const { box, send } = setup(onSend);
    fireEvent.change(box, { target: { value: "hello" } });
    act(() => { send().click(); send().click(); });
    await settle();
    expect(onSend).toHaveBeenCalledTimes(1);

    fireEvent.change(box, { target: { value: "again" } });
    act(() => { send().click(); });
    await settle();
    expect(onSend).toHaveBeenCalledTimes(2);
  });
});
