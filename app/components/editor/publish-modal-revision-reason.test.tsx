// @vitest-environment happy-dom
/**
 * The revision reason, and the fact that it LEAVES the dialog.
 *
 * The publish endpoint has accepted a per-publish `summary` all along — max 500
 * chars, stored on the new `report_versions` row, surfaced as the reason in the
 * report's amendment trail and as the "what changed" line of the amendment
 * email. The editor's publish dialog offered exactly one control (auto-sign) and
 * posted an empty body, so every revision published from it recorded `null`:
 * measured on a real inspection as `[{"n":2,"summary":null},{"n":1,"summary":
 * null}]`.
 *
 * Every assertion here is about the VALUE REACHING `onPublish`, not about a
 * textarea existing. A field that renders and is then dropped on the way out is
 * the defect this fixes, not a fix for it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { PublishModal, type PublishModalProps } from "./PublishModal";

vi.mock("~/hooks/useSessionContext", () => ({
  useSessionContext: () => ({ outboundCoolingWindow: null }),
  useDisplayTimeZone: () => "America/New_York",
  useChromeDateTimeFormat: () => ({ locale: "en-US", dateFormat: "us", timeFormat: "12h" }),
}));

afterEach(cleanup);

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
    isAmendment: true,
    ...over,
  };
}

const reasonBox = () => screen.getByPlaceholderText(/Corrected the roof rating/i);
const publishBtn = () => screen.getByText("Publish Now").closest("button") as HTMLButtonElement;

describe("PublishModal — the revision reason", () => {
  it("asks what changed when the next publish is a revision", () => {
    render(<PublishModal {...props()} />);
    expect(screen.getByText(/What changed in this amendment\?/)).toBeTruthy();
    expect(reasonBox()).toBeTruthy();
  });

  it("does NOT ask on a first publish", () => {
    // The discriminating half: always rendering the box would satisfy the test
    // above and would ask every inspector what changed about a report nobody has
    // seen yet. `report_versions.summary` is NULL on a first publish by design.
    render(<PublishModal {...props({ isAmendment: false })} />);
    expect(screen.queryByText(/What changed in this amendment\?/)).toBeNull();
  });

  it("hands the typed reason to the publish submission", () => {
    const onPublish = vi.fn();
    render(<PublishModal {...props({ onPublish })} />);
    fireEvent.change(reasonBox(), { target: { value: "Corrected the roof rating." } });
    fireEvent.click(publishBtn());
    expect(onPublish).toHaveBeenCalledWith(false, { summary: "Corrected the roof rating." });
  });

  it("trims the reason, and sends NOTHING for a blank one", () => {
    // An empty string is not the same as no reason: the amendment trail would
    // render it as a reason someone wrote. Absent means the endpoint's own
    // default (NULL) stands.
    const onPublish = vi.fn();
    render(<PublishModal {...props({ onPublish })} />);
    fireEvent.change(reasonBox(), { target: { value: "   spaces   " } });
    fireEvent.click(publishBtn());
    expect(onPublish).toHaveBeenLastCalledWith(false, { summary: "spaces" });

    fireEvent.change(reasonBox(), { target: { value: "   " } });
    fireEvent.click(publishBtn());
    expect(onPublish).toHaveBeenLastCalledWith(false, {});
  });

  it("carries the reason on BOTH buttons of the not-yet-complete footer", () => {
    // That footer offers "Just publish" and "Mark complete and publish". The
    // reason has to ride whichever one is pressed — a field wired to one of two
    // publish buttons is a field that vanishes depending on the order axis.
    const onPublish = vi.fn();
    render(<PublishModal {...props({ onPublish, status: "scheduled" })} />);
    fireEvent.change(reasonBox(), { target: { value: "Reworded the summary." } });

    fireEvent.click(screen.getByText("Just publish").closest("button") as HTMLButtonElement);
    expect(onPublish).toHaveBeenLastCalledWith(false, { summary: "Reworded the summary." });

    fireEvent.click(screen.getByText("Mark complete and publish").closest("button") as HTMLButtonElement);
    expect(onPublish).toHaveBeenLastCalledWith(true, { summary: "Reworded the summary." });
  });

  it("sends no reason at all on a first publish", () => {
    // Belt and braces on the payload builder rather than the render: the guard is
    // `isAmendment && trimmed`, so a first publish cannot post a stale reason.
    const onPublish = vi.fn();
    render(<PublishModal {...props({ onPublish, isAmendment: false })} />);
    fireEvent.click(publishBtn());
    expect(onPublish).toHaveBeenCalledWith(false, {});
  });

  it("does not carry one revision's reason into the next", () => {
    // The dialog stays mounted across publishes. A reason left in the box would
    // pre-fill the NEXT revision with the previous one's sentence — shown, but
    // exactly the kind of prefilled text that gets submitted unread.
    const onPublish = vi.fn();
    const view = render(<PublishModal {...props({ onPublish })} />);
    fireEvent.change(reasonBox(), { target: { value: "Corrected the roof rating." } });
    fireEvent.click(publishBtn());

    // The real lifecycle: the submission goes in flight, the route closes the
    // dialog on success, and reopening it is the NEXT publish. The in-flight
    // render is part of it — the dialog only treats a close as a successful
    // publish when it saw a submit, which is what makes a plain Cancel keep
    // whatever was typed.
    view.rerender(<PublishModal {...props({ onPublish, isSubmitting: true })} />);
    view.rerender(<PublishModal {...props({ onPublish, open: false, isSubmitting: false })} />);
    view.rerender(<PublishModal {...props({ onPublish })} />);
    expect((reasonBox() as HTMLTextAreaElement).value).toBe("");
    fireEvent.click(publishBtn());
    expect(onPublish).toHaveBeenLastCalledWith(false, {});
  });

  it("offers no notify switches, because the service ignores them", () => {
    // Deliberate absence, asserted so nobody re-adds them from the endpoint's
    // schema: `publishInspection` reads only the report id out of those options,
    // so a switch would change nothing about who is told while the publish audit
    // entry recorded the flag as given. The dialog's only checkbox is auto-sign.
    const { container } = render(<PublishModal {...props()} />);
    const boxes = container.querySelectorAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(1);
    expect(container.textContent).toContain("Auto-sign");
  });
});
