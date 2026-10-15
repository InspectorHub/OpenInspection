// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ErrorBoundary } from "~/root";

afterEach(cleanup);

// The root boundary is a plain function of the error it is given.
const show = (error: unknown) => render(<ErrorBoundary error={error as never} params={{}} />);

describe("root ErrorBoundary", () => {
  it("tells the person it cannot reach the server on a failed request, with a retry button", () => {
    show(new TypeError("Failed to fetch"));
    expect(screen.getByText("Can't reach the server")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("keeps the generic message for any other error (the control)", () => {
    show(new Error("boom"));
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.queryByText("Can't reach the server")).toBeNull();
  });
});
