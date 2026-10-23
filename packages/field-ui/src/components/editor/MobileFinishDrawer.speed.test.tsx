// @vitest-environment happy-dom
/**
 * The More drawer's Capture group: Speed mode leads it and needs no camera or open item, Burst camera follows when
 * it is offered, and a group with neither is not shown.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MobileFinishDrawer, type MobileFinishDrawerProps } from "./MobileFinishDrawer";
import { m } from "../../i18n";

afterEach(cleanup);

const props = (over: Partial<MobileFinishDrawerProps> = {}): MobileFinishDrawerProps => ({
  open: true,
  onClose: () => {},
  onPublish: () => {},
  onSign: () => {},
  onOpenSettings: null,
  onFinishFieldwork: null,
  finishingFieldwork: false,
  onPreviewReport: null,
  ...over,
});
const sheet = () => screen.getByRole("dialog", { name: m.editor_mobile_more() });

describe("More drawer: Speed mode row", () => {
  it("leads the Capture group, before Burst camera, and works without a burst camera", () => {
    const onSpeedMode = vi.fn();
    const onClose = vi.fn();
    render(<MobileFinishDrawer {...props({ onSpeedMode, onBurstCamera: () => {}, onClose })} />);
    const text = sheet().textContent ?? "";
    expect(text.indexOf(m.editor_mobile_group_capture())).toBeLessThan(text.indexOf(m.editor_dock_speed_mode()));
    expect(text.indexOf(m.editor_dock_speed_mode())).toBeLessThan(text.indexOf(m.editor_mobile_burst_camera()));
    fireEvent.click(within(sheet()).getByRole("button", { name: m.editor_dock_speed_mode() }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSpeedMode).toHaveBeenCalledTimes(1);
  });

  it("Capture exists with Speed mode alone (no camera, no item) and its row is a 44px touch target", () => {
    render(<MobileFinishDrawer {...props({ onSpeedMode: () => {} })} />);
    expect(within(sheet()).queryByText(m.editor_mobile_group_capture())).not.toBeNull();
    expect(within(sheet()).queryByRole("button", { name: m.editor_mobile_burst_camera() })).toBeNull();
    const row = within(sheet()).getByRole("button", { name: m.editor_dock_speed_mode() });
    expect(row.className).toContain("min-h-11");
    expect(row.className).toContain("touch-manipulation");
  });

  it("CONTROL: with neither Speed mode nor Burst there is no Capture heading", () => {
    render(<MobileFinishDrawer {...props({ onSpeedMode: null, onBurstCamera: null })} />);
    expect(within(sheet()).queryByText(m.editor_mobile_group_capture())).toBeNull();
  });
});
