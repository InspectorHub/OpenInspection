// @vitest-environment happy-dom
/**
 * The platform-aware app bar. `web` is the bar the phone has always had, class for class; `ios` and `android`
 * change the back glyph, the title alignment and the more glyph, and add the top safe-area inset; the tablet
 * variant adds the Sections button and a trailing action slot. Back and More are the same two callbacks everywhere.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AppBar, type AppBarProps } from "./AppBar";
import { m } from "../../i18n";

afterEach(cleanup);

const props = (over: Partial<AppBarProps> = {}): AppBarProps => ({
  platform: "web",
  sectionTitle: "Roofing",
  itemLabel: "Flashing condition",
  onBack: () => {},
  onMore: () => {},
  ...over,
});

const bar = () => screen.getByRole("banner");
const back = () => screen.getByRole("button", { name: m.common_back() });
const more = () => screen.getByRole("button", { name: m.editor_mobile_more() });

describe("AppBar web", () => {
  it("is today's phone bar, class for class", () => {
    render(<AppBar {...props()} />);
    expect(bar().className).toBe("sticky top-0 z-30 h-12 bg-ih-bg-card border-b border-ih-border flex items-center pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] gap-2");
    expect(bar().getAttribute("data-platform")).toBe("web");
    expect(back().className).toContain("w-11 h-11 touch-manipulation");
    expect(more().textContent).toBe("⋮");
    const section = screen.getByText("Roofing");
    const item = screen.getByText("Flashing condition");
    expect(section.className).toBe("text-[10px] uppercase tracking-[0.1em] text-ih-fg-3 truncate");
    expect(item.className).toBe("text-[13px] font-bold truncate");
    // Section above item.
    expect(section.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar().className).not.toContain("safe-area-inset-top");
  });
});

describe("AppBar native", () => {
  it.each(["ios", "android"] as const)("%s reserves the top safe area and keeps the visible height", (platform) => {
    render(<AppBar {...props({ platform })} />);
    expect(bar().className).toContain("pt-[env(safe-area-inset-top)]");
    expect(bar().className).toContain("h-[calc(3rem+env(safe-area-inset-top))]");
    expect(bar().getAttribute("data-platform")).toBe(platform);
  });

  it("ios: chevron back, centred title with the item first and the section beneath, horizontal ellipsis", () => {
    render(<AppBar {...props({ platform: "ios" })} />);
    expect(within(back()).getByTestId("app-bar-back-icon").getAttribute("data-glyph")).toBe("chevron-left");
    expect(within(more()).getByTestId("app-bar-more-icon").getAttribute("data-orientation")).toBe("horizontal");
    const title = screen.getByTestId("app-bar-title");
    expect(title.className).toContain("text-center");
    expect(title.firstElementChild?.textContent).toBe("Flashing condition");
    expect(title.lastElementChild?.textContent).toBe("Roofing");
  });

  it("android: arrow back, left aligned title, vertical ellipsis", () => {
    render(<AppBar {...props({ platform: "android" })} />);
    expect(within(back()).getByTestId("app-bar-back-icon").getAttribute("data-glyph")).toBe("arrow-left");
    expect(within(more()).getByTestId("app-bar-more-icon").getAttribute("data-orientation")).toBe("vertical");
    const title = screen.getByTestId("app-bar-title");
    expect(title.className).toContain("text-left");
    expect(title.className).not.toContain("text-center");
    expect(title.firstElementChild?.textContent).toBe("Flashing condition");
  });

  it.each(["web", "ios", "android"] as const)("%s: every control is a 44px target with no tap delay and a focus ring", (platform) => {
    render(<AppBar {...props({ platform })} />);
    for (const b of within(bar()).getAllByRole("button")) {
      expect(b.className).toContain("w-11");
      expect(b.className).toContain("h-11");
      expect(b.className).toContain("touch-manipulation");
      expect(b.className).toContain("focus:shadow-ih-focus");
    }
  });

  it.each(["web", "ios", "android"] as const)("%s: Back and More call the host callbacks, once each", (platform) => {
    const onBack = vi.fn();
    const onMore = vi.fn();
    render(<AppBar {...props({ platform, onBack, onMore })} />);
    fireEvent.click(back());
    fireEvent.click(more());
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onMore).toHaveBeenCalledTimes(1);
  });
});

describe("AppBar tablet", () => {
  it("is 56px tall (48px on a short viewport), has the Sections button and renders the action slot between title and More", () => {
    const onOpenSections = vi.fn();
    render(<AppBar {...props({ tablet: true, onOpenSections, actions: <button type="button">Slot action</button> })} />);
    expect(bar().className).toContain("h-14");
    expect(bar().className).toContain("[@media(max-height:499px)]:h-12");
    expect(bar().className).not.toContain(" h-12 ");
    fireEvent.click(screen.getByRole("button", { name: m.editor_mobile_drawer_sections() }));
    expect(onOpenSections).toHaveBeenCalledTimes(1);
    const names = within(bar()).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names).toEqual([m.common_back(), m.editor_mobile_drawer_sections(), "Slot action", m.editor_mobile_more()]);
  });

  it("native tablet keeps the safe area on top of the 56px bar", () => {
    render(<AppBar {...props({ platform: "ios", tablet: true })} />);
    expect(bar().className).toContain("h-[calc(3.5rem+env(safe-area-inset-top))]");
    expect(bar().className).toContain("pt-[env(safe-area-inset-top)]");
  });

  it("no Sections button without a handler (the phone bar has none)", () => {
    render(<AppBar {...props()} />);
    expect(screen.queryByRole("button", { name: m.editor_mobile_drawer_sections() })).toBeNull();
  });
});

describe("AppBar status slot", () => {
  it.each([false, true])("renders the status between the title and the controls (tablet=%s)", (tablet) => {
    render(<AppBar {...props({ tablet, status: <span>Saving…</span> })} />);
    const title = screen.getByTestId("app-bar-title");
    const status = screen.getByTestId("app-bar-status");
    expect(title.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(status.compareDocumentPosition(more()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("no slot, no wrapper", () => {
    render(<AppBar {...props()} />);
    expect(screen.queryByTestId("app-bar-status")).toBeNull();
  });
});
