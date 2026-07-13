import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { TabStrip } from "./TabStrip";

afterEach(cleanup);

const TABS = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
];

describe("TabStrip", () => {
  it("horizontal (default) keeps bottom-border underline tabs", () => {
    const { container } = render(
      <TabStrip tabs={TABS} activeId="a" onChange={() => {}} />,
    );
    expect((container.firstChild as HTMLElement).className).toContain("border-b");
  });

  it("vertical orientation stacks with left-border accent", () => {
    const { container } = render(
      <TabStrip tabs={TABS} activeId="a" onChange={() => {}} orientation="vertical" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain("flex-col");
    const active = screen.getByRole("button", { name: "Alpha" });
    expect(active.className).toContain("border-l-2");
  });
});
