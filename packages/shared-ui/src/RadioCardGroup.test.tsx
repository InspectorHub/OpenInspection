import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { RadioCardGroup } from "./RadioCardGroup";

afterEach(cleanup);

const OPTS = [
  { value: "own", title: "Bring your own", description: "You pay rates directly." },
  { value: "shared", title: "Managed shared", description: "No setup.", badge: "included" },
  { value: "dedicated", title: "Managed dedicated", description: "Your own number." },
];

describe("RadioCardGroup", () => {
  it("renders every option title, description and badge", () => {
    render(<RadioCardGroup name="m" value="own" onChange={() => {}} options={OPTS} />);
    expect(screen.getByText("Bring your own")).toBeTruthy();
    expect(screen.getByText("You pay rates directly.")).toBeTruthy();
    expect(screen.getByText("included")).toBeTruthy();
  });

  it("checks the option matching value and exposes radiogroup semantics", () => {
    render(<RadioCardGroup name="m" value="shared" onChange={() => {}} options={OPTS} legend="Delivery" />);
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios[0].checked).toBe(false);
    expect(radios[1].checked).toBe(true);
    // Selected card carries the canonical active token.
    const selectedCard = radios[1].closest("label")!;
    expect(selectedCard.className).toContain("border-ih-primary");
    expect(selectedCard.className).toContain("bg-ih-primary/5");
  });

  it("calls onChange with the value when a card is selected", () => {
    const onChange = vi.fn();
    render(<RadioCardGroup name="m" value="own" onChange={onChange} options={OPTS} />);
    fireEvent.click(screen.getByText("Managed dedicated"));
    expect(onChange).toHaveBeenCalledWith("dedicated");
  });

  it("moves selection with arrow keys", () => {
    const onChange = vi.fn();
    render(<RadioCardGroup name="m" value="own" onChange={onChange} options={OPTS} />);
    const radios = screen.getAllByRole("radio");
    fireEvent.keyDown(radios[0], { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith("shared");
  });

  it("does not select a disabled option", () => {
    const onChange = vi.fn();
    const opts = [OPTS[0], { ...OPTS[1], disabled: true }];
    render(<RadioCardGroup name="m" value="own" onChange={onChange} options={opts} />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios[1].disabled).toBe(true);
  });

  it("renders error over hint when both are present", () => {
    render(<RadioCardGroup name="m" value="own" onChange={() => {}} options={OPTS} error="Required" hint="Pick one" />);
    expect(screen.getByText("Required")).toBeTruthy();
    expect(screen.queryByText("Pick one")).toBeNull();
  });
});
