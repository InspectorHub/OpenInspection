/**
 * Two rules for the hub's cards, because it is a column of siblings a reader
 * scans rather than reads — so position has to carry meaning on its own:
 *
 *   1. The card header is a LABEL, never a control: title left, status right.
 *   2. Every card's actions live at the BOTTOM of the card.
 *
 * The header briefly carried an action slot for "the card's one entry action".
 * It read as random — People and Schedule got header buttons while Agreement
 * and Invoice got body buttons, and nothing on screen said why, because you
 * cannot see how many actions a card has before you look at it. It also could
 * never cover Report, which has six.
 *
 * This asserts the header holds nothing clickable, which is the half of the
 * rule a component test can hold still.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { BlockHeading } from "./BlockHeading";

afterEach(cleanup);

describe("BlockHeading — the card header is a label, not a control", () => {
  it("renders the title with its status", () => {
    render(<BlockHeading title="Agreement" pill={{ tone: "monitor", label: "Awaiting signature" }} />);
    expect(screen.getByRole("heading", { name: "Agreement" })).toBeTruthy();
    expect(screen.getByText("Awaiting signature")).toBeTruthy();
  });

  it("puts nothing clickable in the header", () => {
    render(<BlockHeading title="People" pill={{ tone: "sat", label: "Ready" }} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders a bare title when the card has no status to report", () => {
    render(<BlockHeading title="Services" />);
    expect(screen.getByRole("heading", { name: "Services" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("accepts only a title and a pill — there is no action slot to drift back into", () => {
    // A compile-time contract expressed as a runtime one: passing an action is
    // not a supported shape, so nothing renders for it.
    const props = { title: "Invoice", action: <button type="button">Nope</button> } as {
      title: string;
    };
    render(<BlockHeading {...props} />);
    expect(screen.queryByRole("button", { name: "Nope" })).toBeNull();
  });
});
