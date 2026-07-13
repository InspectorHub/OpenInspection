import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { Button } from "./Button";

afterEach(cleanup);

test("link variant renders borderless text action", () => {
  render(<Button variant="link">Browse library</Button>);
  const btn = screen.getByRole("button", { name: "Browse library" });
  expect(btn.className).toContain("text-ih-primary");
  expect(btn.className).toContain("hover:underline");
  expect(btn.className).not.toContain("bg-ih-primary");
});

test("danger-link variant renders borderless destructive text", () => {
  render(<Button variant="danger-link">Remove</Button>);
  const btn = screen.getByRole("button", { name: "Remove" });
  expect(btn.className).toContain("text-ih-bad-fg");
  expect(btn.className).toContain("hover:underline");
  expect(btn.className).not.toContain("bg-ih-bad");
});

describe("Button className merge (tailwind-merge)", () => {
  it("consumer className wins over the base display utility on same-property conflict", () => {
    render(
      <Button variant="primary" className="hidden xl:inline-flex">
        Responsive
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Responsive" });
    expect(btn.className).toContain("hidden");
    expect(btn.className).toContain("xl:inline-flex");
    // The base's unprefixed `inline-flex` must be dropped in favor of `hidden`
    // — tailwind-merge resolves same-property conflicts by className order,
    // not stylesheet order.
    expect(btn.className.split(/\s+/)).not.toContain("inline-flex");
  });

  it("consumer size className wins over the size preset's height", () => {
    render(
      <Button size="md" className="h-12">
        Tall
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Tall" });
    expect(btn.className).toContain("h-12");
    expect(btn.className.split(/\s+/)).not.toContain("h-9");
  });
});

describe("Button selected state", () => {
  it("selected sets aria-pressed and pressed style", () => {
    render(
      <Button variant="secondary" selected>
        Tag
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Tag" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.className).toContain("ring-ih-primary");
  });

  it("unselected omits aria-pressed", () => {
    render(<Button variant="secondary">Tag</Button>);
    expect(screen.getByRole("button", { name: "Tag" }).hasAttribute("aria-pressed")).toBe(false);
  });
});

describe("Button type defaults", () => {
  it("defaults to type=button (safe inside a <form>)", () => {
    render(<Button>Click</Button>);
    expect(screen.getByRole("button", { name: "Click" }).getAttribute("type")).toBe("button");
  });

  it("explicit type=submit overrides the default", () => {
    render(<Button type="submit">Save</Button>);
    expect(screen.getByRole("button", { name: "Save" }).getAttribute("type")).toBe("submit");
  });
});
