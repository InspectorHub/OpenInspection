// @vitest-environment happy-dom
// Invariant: the Send button is never natively disabled, so a focused Send keeps focus when
// handleSend clears the body on success; an empty body is aria-disabled with an inert click.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("~/hooks/useSessionContext", () => ({
  useDisplayTimeZone: () => "UTC",
  useDisplayLocale: () => "en-US",
}));

import { MessageThread } from "~/components/messaging/MessageThread";
import { m } from "~/paraglide/messages";

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

describe("MessageThread Send button", () => {
  it("an empty body is aria-disabled (not native) and a click does nothing", () => {
    const onSend = vi.fn(async () => {});
    const { send } = setup(onSend);
    expect(send().getAttribute("aria-disabled")).toBe("true");
    expect(send().hasAttribute("disabled")).toBe(false);
    fireEvent.click(send());
    expect(onSend).not.toHaveBeenCalled();
  });

  it("keeps focus on Send after a successful send clears the body", async () => {
    const onSend = vi.fn(async () => {});
    const { box, send } = setup(onSend);
    fireEvent.change(box, { target: { value: "hello" } });
    expect(send().getAttribute("aria-disabled")).toBeNull();
    send().focus();
    fireEvent.click(send());
    await waitFor(() => expect(box.value).toBe(""));
    expect(onSend).toHaveBeenCalledWith("hello");
    expect(send().hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(send());
  });
});
