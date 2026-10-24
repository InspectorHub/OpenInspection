// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SpeedEntryButton } from "./SpeedEntryButton";
import { m } from "../../i18n";

afterEach(cleanup);

describe("SpeedEntryButton", () => {
  it("says how many are unrated, is a 44px touch target and opens on press", () => {
    const onOpen = vi.fn();
    render(<SpeedEntryButton unrated={7} onOpen={onOpen} />);
    const b = screen.getByRole("button", { name: m.editor_speed_rate_unrated({ count: 7 }) });
    expect(b.className).toContain("min-h-11");
    expect(b.className).toContain("touch-manipulation");
    fireEvent.click(b);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1])("renders nothing when %i are left to rate: Speed mode would refuse to open", (n) => {
    const { container } = render(<SpeedEntryButton unrated={n} onOpen={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
