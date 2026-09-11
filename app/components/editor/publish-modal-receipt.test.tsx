// @vitest-environment happy-dom
/**
 * What the publish dialog PROMISES, and what it says afterwards.
 *
 * Two defects, one screen:
 *
 *  1. The dialog said *"Publishing will finalize this inspection and make the
 *     report available to clients."* Publishing makes the report published,
 *     writes a version row and fires the automations — it mints no link and
 *     sends no mail in that request; the queued notices are delivered later by
 *     the five-minute `automation-flush` cron, and the actual put-it-in-their-
 *     inbox control is "Send report" on the inspection page. An inspector who
 *     read that sentence and stopped had a client with nothing.
 *  2. Pressing Publish produced no acknowledgement at all — no toast, no
 *     summary, no next step, and the Publish button still sitting there.
 *
 * The receipt reuses the dialog's own delivery sentence on purpose, so the two
 * cannot drift into promising different things.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { PublishModal, type PublishModalProps } from "./PublishModal";

// The session hooks read route loader data, which needs a data router. Mocked
// the same way the sibling cooling-window spec does — no cooling window, so the
// dialog under test is the ordinary one.
vi.mock("~/hooks/useSessionContext", () => ({
  useSessionContext: () => ({ outboundCoolingWindow: null }),
  useDisplayTimeZone: () => "America/New_York",
  useChromeDateTimeFormat: () => ({ locale: "en-US", dateFormat: "us", timeFormat: "12h" }),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

/** The claim this work removed. Quoted in full — a partial match would let a reword through. */
const OLD_CLAIM = "make the report available to clients";

function props(over: Partial<PublishModalProps> = {}): PublishModalProps {
  return {
    open: true,
    progress: { rated: 40, total: 40, pct: 100 },
    status: "completed",
    publishError: null,
    isSubmitting: false,
    onClose: vi.fn(),
    onPublish: vi.fn(),
    autoSign: false,
    onAutoSignToggle: vi.fn(),
    isAmendment: false,
    ...over,
  };
}

describe("PublishModal — what the dialog claims publishing does", () => {
  it("does not say publishing makes the report available to clients", () => {
    const { container } = render(<PublishModal {...props()} />);
    expect(container.textContent).not.toContain(OLD_CLAIM);
  });

  it("says what publishing achieves AND that it sends nothing by itself", () => {
    // The discriminating half: deleting the old sentence and saying nothing
    // would satisfy the test above. The dialog has to state both halves, and
    // name where sending actually happens.
    const { container } = render(<PublishModal {...props()} />);
    const text = container.textContent ?? "";
    expect(text).toContain("records a new version");
    expect(text).toContain("does not send the report itself");
    expect(text).toContain("Send report");
  });
});

describe("PublishModal — the receipt", () => {
  /** Mount submitting, then re-render as the owning route does on success. */
  function publishThen(over: Partial<PublishModalProps> = {}) {
    const view = render(<PublishModal {...props({ isSubmitting: true })} />);
    view.rerender(<PublishModal {...props({ open: false, isSubmitting: false, ...over })} />);
    return view;
  }

  it("reports the publish, and states that nothing has been emailed yet", () => {
    publishThen();
    expect(screen.getByText("Report published")).toBeTruthy();
    expect(screen.getByText(/Nothing has been emailed by this step/)).toBeTruthy();
    // The same sentence the dialog showed before the click.
    expect(screen.getByText(/does not send the report itself/)).toBeTruthy();
  });

  it("offers the next step as a link to this inspection's page", () => {
    window.history.replaceState({}, "", "/inspections/abc123/edit");
    const { container } = publishThen();
    const link = container.querySelector("a") as HTMLAnchorElement;
    expect(link.textContent).toContain("Go to the inspection");
    // Raw attribute, not `.href` — the DOM would resolve that to an absolute URL.
    expect(link.getAttribute("href")).toBe("/inspections/abc123");
  });

  it("states the next step without a link when the address is not the editor's", () => {
    // Degrading to words beats a button that navigates somewhere wrong: the path
    // is the only thing this dialog can derive the inspection id from.
    window.history.replaceState({}, "", "/somewhere/else");
    const { container } = publishThen();
    expect(screen.getByText("Report published")).toBeTruthy();
    expect(container.querySelector("a")).toBeNull();
  });

  it("shows no receipt when the publish FAILED", () => {
    // The route keeps the dialog open and puts the reason in `publishError`, so
    // "closed" is the success signal — this pins that it is read as such.
    const view = render(<PublishModal {...props({ isSubmitting: true })} />);
    view.rerender(
      <PublishModal {...props({ open: true, isSubmitting: false, publishError: "Nope." })} />,
    );
    expect(screen.queryByText("Report published")).toBeNull();
    expect(screen.getByText("Nope.")).toBeTruthy();
  });

  it("shows no receipt when the dialog is merely cancelled", () => {
    // Opened, closed, never submitted. A receipt here would report a publish
    // that did not happen — the same class of untruth as the old claim.
    const view = render(<PublishModal {...props()} />);
    view.rerender(<PublishModal {...props({ open: false })} />);
    expect(screen.queryByText("Report published")).toBeNull();
  });
});
