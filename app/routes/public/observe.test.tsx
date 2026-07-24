import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ObserveRetiredPage from "./observe";

describe("observe route — retired standalone live-progress surface", () => {
  it("renders a retirement notice pointing to the client portal", () => {
    render(<ObserveRetiredPage />);
    // The heading announces the retirement...
    expect(screen.getByText(/live-progress link has retired/i)).toBeTruthy();
    // ...and the body directs the visitor to the client portal instead of
    // rendering live section progress here.
    expect(screen.getByText(/client portal/i)).toBeTruthy();
  });

  it("does not render live section-progress UI", () => {
    render(<ObserveRetiredPage />);
    // The old page rendered a ProgressView with a "not found"/progress error
    // string; the retired surface must not surface any of that.
    expect(screen.queryByText(/Inspection not found/i)).toBeNull();
    expect(screen.queryByText(/Service unavailable/i)).toBeNull();
  });
});
