import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SideRail } from "../../../app/components/editor/SideRail";

describe("SideRail — Library tab type gate (module E)", () => {
  it("fill mode: shows Library for a rich item", () => {
    render(<SideRail mode="fill" initialOpen activeItem={{ id: "i1", label: "Attic", type: "rich" }} />);
    expect(screen.getByRole("button", { name: /Library/ })).toBeTruthy();
  });

  it("fill mode: hides Library for a non-rich item", () => {
    render(<SideRail mode="fill" initialOpen activeItem={{ id: "i2", label: "Year", type: "number" }} />);
    expect(screen.queryByRole("button", { name: /Library/ })).toBeNull();
  });

  it("fill mode: shows Library when no item is active (nothing to gate on)", () => {
    render(<SideRail mode="fill" initialOpen />);
    expect(screen.getByRole("button", { name: /Library/ })).toBeTruthy();
  });

  it("author mode: always shows Library regardless of item type", () => {
    render(<SideRail mode="author" initialOpen activeItem={{ id: "i3", label: "Year", type: "number" }} />);
    expect(screen.getByRole("button", { name: /Library/ })).toBeTruthy();
  });
});
