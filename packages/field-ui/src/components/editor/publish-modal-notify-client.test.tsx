// @vitest-environment happy-dom
/**
 * "Notify the client that the report was updated": the inspector's choice at REPUBLISH.
 *
 * The box exists only for a revision, starts unchecked, and its value must LEAVE the dialog on the publish submission:
 * a checkbox that renders and is then dropped on the way out is the defect, not a fix. A first publish has no box and
 * never sends the key, whatever state a previous revision left behind.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";
import { PublishModal, type PublishModalProps } from "./PublishModal";
import { FieldDataSourceProvider } from "../../context";
import { m } from "../../i18n";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";

const fake = createFakeDataSource({ data: createEmptyEditorData() });
function PM(props: PublishModalProps) {
  return (
    <FieldDataSourceProvider dataSource={fake}>
      <PublishModal {...props} />
    </FieldDataSourceProvider>
  );
}

afterEach(cleanup);

function props(over: Partial<PublishModalProps> = {}): PublishModalProps {
  return {
    open: true,
    inspectionId: "insp-1",
    progress: { rated: 40, total: 40, pct: 100 },
    status: "completed",
    publishError: null,
    isSubmitting: false,
    onClose: vi.fn(),
    onPublish: vi.fn(),
    autoSign: false,
    onAutoSignToggle: vi.fn(),
    isAmendment: true,
    noticeChoice: true,
    ...over,
  };
}

const notifyBox = () => screen.getByLabelText(m.editor_publish_notify_client()) as HTMLInputElement;
const publishBtn = () => screen.getByText("Publish Now").closest("button") as HTMLButtonElement;

describe("PublishModal - notify the client on republish", () => {
  it("is offered for a revision, unchecked by default", () => {
    render(<PM {...props()} />);
    expect(notifyBox().checked).toBe(false);
  });

  it("is NOT offered on a first publish", () => {
    render(<PM {...props({ isAmendment: false, noticeChoice: false })} />);
    expect(screen.queryByLabelText(m.editor_publish_notify_client())).toBeNull();
  });

  it("sends nothing about notifying when left unchecked", () => {
    const onPublish = vi.fn();
    render(<PM {...props({ onPublish })} />);
    fireEvent.click(publishBtn());
    expect(onPublish).toHaveBeenCalledWith(false, {});
  });

  it("hands the choice to the publish submission when ticked, alongside the reason", () => {
    const onPublish = vi.fn();
    render(<PM {...props({ onPublish })} />);
    fireEvent.click(notifyBox());
    fireEvent.change(screen.getByPlaceholderText(/Corrected the roof rating/i), { target: { value: "Fixed it." } });
    fireEvent.click(publishBtn());
    expect(onPublish).toHaveBeenCalledWith(false, { summary: "Fixed it.", notifyClient: true });
  });

  it("carries the choice on BOTH buttons of the not-yet-complete footer", () => {
    const onPublish = vi.fn();
    const view = render(<PM {...props({ onPublish, status: "scheduled" })} />);
    fireEvent.click(notifyBox());
    fireEvent.click(screen.getByText("Just publish").closest("button") as HTMLButtonElement);
    expect(onPublish).toHaveBeenLastCalledWith(false, { notifyClient: true });
    view.rerender(<PM {...props({ onPublish, status: "scheduled", isSubmitting: true })} />);
    view.rerender(<PM {...props({ onPublish, status: "scheduled" })} />);
    fireEvent.click(screen.getByText("Mark complete and publish").closest("button") as HTMLButtonElement);
    expect(onPublish).toHaveBeenLastCalledWith(true, { notifyClient: true });
  });

  it("is NOT offered for a republish after a retract: it has earlier versions (the dialog still asks what changed) but the server will not honour a choice", () => {
    const onPublish = vi.fn();
    render(<PM {...props({ onPublish, isAmendment: true, noticeChoice: false })} />);
    expect(screen.queryByLabelText(m.editor_publish_notify_client())).toBeNull();
    expect(screen.getByText(/What changed in this amendment\?/)).toBeTruthy();
    // The dialog makes no promise about notices beyond the first-publish sentence.
    expect(screen.getByText(m.report_publish_body_delivery())).toBeTruthy();
    expect(screen.queryByText(m.report_publish_body_delivery_amendment())).toBeNull();
    fireEvent.click(publishBtn());
    expect(onPublish).toHaveBeenCalledWith(false, {});
  });

  it("receipt after a retract-republish claims nothing about notices the server did not decide", async () => {
    const view = render(<PM {...props({ isAmendment: true, noticeChoice: false })} />);
    fireEvent.click(publishBtn());
    view.rerender(<PM {...props({ isAmendment: true, noticeChoice: false, isSubmitting: true })} />);
    view.rerender(<PM {...props({ isAmendment: true, noticeChoice: false, open: false, isSubmitting: false })} />);
    await screen.findByText(m.report_publish_receipt_nothing_sent());
    const text = document.body.textContent ?? "";
    expect(text).toContain(m.report_publish_body_delivery());
    expect(text).not.toContain(m.report_publish_receipt_amendment_not_notified());
    expect(text).not.toContain(m.report_publish_receipt_amendment_notified());
  });

  it("receipt when the server found nothing changed: only the unchanged sentence, whatever was ticked", async () => {
    const view = render(<PM {...props()} />);
    fireEvent.click(notifyBox());
    fireEvent.click(publishBtn());
    view.rerender(<PM {...props({ isSubmitting: true })} />);
    view.rerender(<PM {...props({ open: false, isSubmitting: false, unchangedSinceVersion: 3 })} />);
    await screen.findByText(m.report_publish_receipt_unchanged({ version: 3 }));
    expect(screen.getByText(m.report_publish_receipt_title_unchanged())).toBeTruthy();
    expect(screen.queryByText(m.report_publish_receipt_title())).toBeNull();
    const text = document.body.textContent ?? "";
    // The sentences that say a new version was recorded and that nothing was emailed would contradict it.
    expect(text).not.toContain(m.report_publish_receipt_nothing_sent());
    expect(text).not.toContain(m.report_publish_receipt_amendment_notified());
    expect(text).not.toContain(m.report_publish_receipt_amendment_not_notified());
    expect(text).not.toContain(m.report_publish_body_delivery());
  });

  it("is unchecked again the next time the dialog opens", () => {
    const view = render(<PM {...props()} />);
    fireEvent.click(notifyBox());
    expect(notifyBox().checked).toBe(true);
    view.rerender(<PM {...props({ open: false })} />);
    view.rerender(<PM {...props()} />);
    expect(notifyBox().checked).toBe(false);
  });

  it("a first publish never sends the key, even right after a revision ticked it", () => {
    const onPublish = vi.fn();
    const view = render(<PM {...props({ onPublish })} />);
    fireEvent.click(notifyBox());
    view.rerender(<PM {...props({ onPublish, isAmendment: false, noticeChoice: false })} />);
    fireEvent.click(publishBtn());
    expect(onPublish).toHaveBeenLastCalledWith(false, {});
  });

  it("the dialog says the notices go out only if the box is ticked", () => {
    render(<PM {...props()} />);
    expect(screen.getByText(m.report_publish_body_delivery_amendment())).toBeTruthy();
    expect(screen.queryByText(m.report_publish_body_delivery())).toBeNull();
  });

  /** Submit, let the route close the dialog, and return the receipt's text. */
  async function receiptAfter(tick: boolean) {
    const view = render(<PM {...props()} />);
    if (tick) fireEvent.click(notifyBox());
    fireEvent.click(publishBtn());
    view.rerender(<PM {...props({ isSubmitting: true })} />);
    // The order now reads as published and the box is gone: the receipt must still say what THIS submission was.
    view.rerender(<PM {...props({ open: false, isSubmitting: false })} />);
    await screen.findByText(m.report_publish_receipt_nothing_sent());
    return document.body.textContent ?? "";
  }

  it("receipt, box ticked: says the report-updated notices were queued, and does not point at a box", async () => {
    const text = await receiptAfter(true);
    expect(text).toContain(m.report_publish_receipt_amendment_notified());
    expect(text).not.toContain(m.report_publish_receipt_amendment_not_notified());
    expect(text).not.toContain(m.report_publish_body_delivery_amendment());
    expect(text).not.toMatch(/box below/i);
  });

  it("receipt, box left unticked: says no report-updated notices were sent", async () => {
    const text = await receiptAfter(false);
    expect(text).toContain(m.report_publish_receipt_amendment_not_notified());
    expect(text).not.toContain(m.report_publish_receipt_amendment_notified());
    expect(text).not.toMatch(/box below/i);
  });

  it("(control) a first publish keeps the original sentence, in the dialog and in the receipt", async () => {
    const view = render(<PM {...props({ isAmendment: false, noticeChoice: false })} />);
    expect(screen.getByText(m.report_publish_body_delivery())).toBeTruthy();
    fireEvent.click(publishBtn());
    // The order now reads as published and reopened-looking by the time the receipt shows; the receipt keeps to what was submitted.
    view.rerender(<PM {...props({ isAmendment: false, noticeChoice: false, isSubmitting: true })} />);
    view.rerender(<PM {...props({ isAmendment: true, noticeChoice: true, open: false, isSubmitting: false })} />);
    expect(await screen.findAllByText(m.report_publish_body_delivery())).toHaveLength(1);
  });

  it("two clicks in one frame still submit once (the existing latch covers the new field)", () => {
    const onPublish = vi.fn();
    render(<PM {...props({ onPublish })} />);
    fireEvent.click(notifyBox());
    const btn = publishBtn();
    act(() => { btn.click(); btn.click(); });
    expect(onPublish).toHaveBeenCalledTimes(1);
  });
});
