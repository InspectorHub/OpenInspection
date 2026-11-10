// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { Banner } from "@core/shared-ui";

afterEach(cleanup);

describe("Banner", () => {
  it("renders its children", () => {
    render(<Banner tone="info">Hello banner</Banner>);
    expect(screen.getByText("Hello banner")).toBeTruthy();
  });

  it("applies tone-specific classes that differ between tones", () => {
    const { container: infoC } = render(<Banner tone="info">i</Banner>);
    const info = infoC.firstChild as HTMLElement;
    cleanup();
    const { container: dangerC } = render(<Banner tone="danger">d</Banner>);
    const danger = dangerC.firstChild as HTMLElement;

    expect(info.className).toContain("bg-ih-info-bg");
    expect(danger.className).toContain("bg-ih-bad-bg");
    expect(info.className).not.toBe(danger.className);
  });

  it("uses role=status for passive tones (info/success/brand)", () => {
    render(<Banner tone="info">i</Banner>);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("uses role=alert for actionable tones (warn/danger)", () => {
    render(<Banner tone="danger">d</Banner>);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("renders the actions slot", () => {
    render(
      <Banner tone="warn" actions={<button type="button">Upgrade</button>}>
        w
      </Banner>,
    );
    expect(screen.getByText("Upgrade")).toBeTruthy();
  });

  it("renders a dismiss affordance that calls onDismiss when clicked", () => {
    const onDismiss = vi.fn();
    render(
      <Banner tone="info" dismissible onDismiss={onDismiss}>
        i
      </Banner>,
    );
    const button = screen.getByRole("button", { name: /dismiss/i });
    fireEvent.click(button);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not render a dismiss affordance when not dismissible", () => {
    render(<Banner tone="info">i</Banner>);
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  it("applies the sticky variant class when sticky", () => {
    const { container } = render(
      <Banner tone="brand" sticky>
        b
      </Banner>,
    );
    expect((container.firstChild as HTMLElement).className).toContain("sticky");
  });

  it("renders a leading icon when provided", () => {
    render(
      <Banner tone="info" icon={<span data-testid="lead-icon">*</span>}>
        i
      </Banner>,
    );
    expect(screen.getByTestId("lead-icon")).toBeTruthy();
  });

  // Layout is not computed in happy-dom, so these pin the classes that make it. On a phone the icon, the text
  // and the dismiss button share ONE row (text `flex-1 min-w-0`, icon and dismiss `shrink-0`, dismiss ordered
  // right after the text) and only the ACTIONS wrap to a full-width row beneath. From `sm` up the original
  // layout holds: text flex-1, actions inline at the right, dismiss last. The DOM keeps its original order
  // (icon, text, actions, dismiss) so keyboard order stays icon-free: actions before dismiss.
  const cls = (el: HTMLElement) => el.className;

  it("with no icon and no actions the text is the only flexible item", () => {
    render(<Banner tone="info">Plain notice</Banner>);
    const text = screen.getByText("Plain notice");
    expect(cls(text)).toContain("min-w-0");
    expect(cls(text)).toContain("flex-1");
    expect(cls(text)).not.toContain("basis-full");
  });

  it("keeps icon, text and dismiss on one row on a phone", () => {
    render(
      <Banner tone="info" icon={<i data-testid="ic" />} dismissible onDismiss={() => {}}>
        Notice
      </Banner>,
    );
    const icon = screen.getByTestId("ic").parentElement as HTMLElement;
    const text = screen.getByText("Notice");
    const dismiss = screen.getByRole("button", { name: /dismiss/i });
    expect(cls(icon)).toContain("shrink-0");
    expect(cls(text)).toContain("flex-1");
    expect(cls(dismiss)).toContain("shrink-0");
    expect(cls(text)).not.toContain("basis-full");
  });

  it("wraps only the actions to a full-width row beneath, ordered after the dismiss button on a phone", () => {
    render(
      <Banner tone="info" dismissible onDismiss={() => {}} actions={<a href="/x">Do it</a>}>
        A long notice that should not be squeezed into a narrow column beside its link.
      </Banner>,
    );
    const actions = screen.getByText("Do it").parentElement as HTMLElement;
    const dismiss = screen.getByRole("button", { name: /dismiss/i });
    expect(cls(actions)).toContain("w-full");
    expect(cls(actions)).toContain("order-4");
    expect(cls(dismiss)).toContain("order-3");
    // From sm up: actions inline at the right, dismiss last, as before.
    expect(cls(actions)).toContain("sm:w-auto");
    expect(cls(actions)).toContain("sm:ml-auto");
    expect(cls(actions)).toContain("sm:order-3");
    expect(cls(dismiss)).toContain("sm:order-4");
  });

  it("with icon, text, actions and dismiss: icon first, text second, both stay beside each other", () => {
    render(
      <Banner tone="warn" icon={<i data-testid="ic" />} dismissible onDismiss={() => {}} actions={<a href="/x">Go</a>}>
        Everything
      </Banner>,
    );
    expect(cls(screen.getByTestId("ic").parentElement as HTMLElement)).toContain("order-1");
    expect(cls(screen.getByText("Everything"))).toContain("order-2");
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("uses compact padding on a phone", () => {
    const { container } = render(<Banner tone="info">i</Banner>);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("py-2");
    expect(root.className).toContain("sm:py-3");
  });
});
