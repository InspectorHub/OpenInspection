// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { RouteErrorNotice } from "~/components/RouteErrorNotice";

afterEach(cleanup);

const messages = { notFound: "Missing one", forbidden: "Not yours", generic: "Something broke" };
const back = { to: "/things", label: "Back to things" };

function show(error: unknown) {
  const Stub = createRoutesStub([{ path: "/", Component: () => <RouteErrorNotice error={error} messages={messages} back={back} /> }]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("RouteErrorNotice", () => {
  it("says it cannot reach the server on a failed request, and offers a retry instead of a link", async () => {
    show(new TypeError("Failed to fetch"));
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Back to things" })).toBeNull();
  });

  it("the retry reloads the page", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    show(new TypeError("Failed to fetch"));
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("keeps the way back and the route's own wording for an ordinary error (the control for the case above)", async () => {
    show(new Error("boom"));
    expect(await screen.findByText("Something broke")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to things" })).toBeTruthy();
    expect(screen.queryByText(/Can't reach the server/)).toBeNull();
  });
});
