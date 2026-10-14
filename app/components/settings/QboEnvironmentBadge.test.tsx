// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QboEnvironmentBadge } from "./QboEnvironmentBadge";

afterEach(cleanup);

describe("QboEnvironmentBadge", () => {
  it("shows sandbox in the attention (amber) tokens", () => {
    render(<QboEnvironmentBadge environment="sandbox" />);
    const badge = screen.getByText("Sandbox");
    expect(badge.className).toContain("bg-ih-watch-bg");
    expect(badge.className).toContain("text-ih-watch-fg");
    // The other environment's colours must not leak onto it.
    expect(badge.className).not.toContain("bg-ih-ok-bg");
  });

  it("shows production in the ok (green) tokens", () => {
    render(<QboEnvironmentBadge environment="production" />);
    const badge = screen.getByText("Production");
    expect(badge.className).toContain("bg-ih-ok-bg");
    expect(badge.className).toContain("text-ih-ok-fg");
    expect(badge.className).not.toContain("bg-ih-watch-bg");
  });

  it("renders nothing when the environment is unknown, rather than guessing one", () => {
    const { container } = render(<QboEnvironmentBadge environment={null} />);
    expect(container).toBeEmptyDOMElement();
    // Control: a known environment does render something.
    cleanup();
    const known = render(<QboEnvironmentBadge environment="sandbox" />);
    expect(known.container).not.toBeEmptyDOMElement();
  });
});
