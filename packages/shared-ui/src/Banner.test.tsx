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
});
