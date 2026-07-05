import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { Avatar, avatarInitials } from "@core/shared-ui";

afterEach(cleanup);

describe("avatarInitials", () => {
  it("derives first letters of the first two words for multi-word names", () => {
    expect(avatarInitials("John Smith")).toBe("JS");
    expect(avatarInitials("mary jane watson")).toBe("MJ");
  });

  it("uses the first two characters for a single-word name", () => {
    expect(avatarInitials("Alice")).toBe("AL");
    expect(avatarInitials("bob")).toBe("BO");
  });

  it("returns empty string for an empty name", () => {
    expect(avatarInitials("")).toBe("");
    expect(avatarInitials("   ")).toBe("");
  });
});

describe("Avatar", () => {
  it("renders derived initials from a multi-word name", () => {
    render(<Avatar name="John Smith" />);
    expect(screen.getByText("JS")).toBeTruthy();
  });

  it("renders derived initials from a single-word name", () => {
    render(<Avatar name="Alice" />);
    expect(screen.getByText("AL")).toBeTruthy();
  });

  it("exposes an img role with aria-label equal to the name", () => {
    render(<Avatar name="John Smith" />);
    const el = screen.getByRole("img", { name: "John Smith" });
    expect(el).toBeTruthy();
  });

  it("applies the size to the avatar box dimensions", () => {
    const { container } = render(<Avatar name="John Smith" size={36} />);
    expect(container.innerHTML).toContain("w-9");
    expect(container.innerHTML).toContain("h-9");
  });

  it("defaults to size 32 (w-8 h-8) when no size is given", () => {
    const { container } = render(<Avatar name="John Smith" />);
    expect(container.innerHTML).toContain("w-8");
    expect(container.innerHTML).toContain("h-8");
  });

  it("renders distinct styling for self vs flat variants", () => {
    const { container: selfC } = render(<Avatar name="Jo" variant="self" />);
    const selfHtml = selfC.innerHTML;
    cleanup();
    const { container: flatC } = render(<Avatar name="Jo" variant="flat" />);
    const flatHtml = flatC.innerHTML;

    expect(selfHtml).toContain("from-ih-primary");
    expect(flatHtml).toContain("bg-ih-bg-muted");
    expect(selfHtml).not.toBe(flatHtml);
  });

  it("defaults to the flat variant", () => {
    const { container } = render(<Avatar name="Jo" />);
    expect(container.innerHTML).toContain("bg-ih-bg-muted");
  });

  it("renders a status dot when statusDot is set", () => {
    const { container } = render(<Avatar name="Jo" statusDot="online" />);
    const dot = container.querySelector('[data-avatar-status]');
    expect(dot).toBeTruthy();
    expect((dot as HTMLElement).className).toContain("bg-ih-ok");
  });

  it("renders an offline status dot with a muted color", () => {
    const { container } = render(<Avatar name="Jo" statusDot="offline" />);
    const dot = container.querySelector('[data-avatar-status]');
    expect(dot).toBeTruthy();
    expect((dot as HTMLElement).className).toContain("bg-ih-fg-4");
  });

  it("does not render a status dot by default", () => {
    const { container } = render(<Avatar name="Jo" />);
    expect(container.querySelector('[data-avatar-status]')).toBeNull();
  });

  it("renders a ring border when ring is set", () => {
    const { container } = render(<Avatar name="Jo" ring />);
    expect(container.innerHTML).toContain("ring-");
  });

  it("shows the fallback icon when the name is empty", () => {
    render(
      <Avatar name="" fallbackIcon={<span data-testid="fallback">*</span>} />,
    );
    expect(screen.getByTestId("fallback")).toBeTruthy();
  });

  it("passes through a custom className", () => {
    const { container } = render(<Avatar name="Jo" className="custom-x" />);
    expect(container.innerHTML).toContain("custom-x");
  });
});
