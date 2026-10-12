// @vitest-environment happy-dom
/**
 * A fast double click on a template's on/off switch must post the toggle once.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { TemplateList, type TemplateRow } from "./TemplateList";

afterEach(cleanup);

const ROW: TemplateRow = {
  trigger: "booking-confirmed", name: "Booking confirmed", category: "client",
  required: false, enabled: true, isCustomized: false, subject: "Your booking",
};

describe("TemplateList - toggle", () => {
  it("reaches the action once when clicked twice in one frame", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const Stub = createRoutesStub([
      {
        path: "/templates",
        Component: () => <TemplateList rows={[ROW]} />,
        action: async () => {
          calls += 1;
          await new Promise<void>((resolve) => { release = resolve; });
          return null;
        },
      },
    ]);
    render(<Stub initialEntries={["/templates"]} />);
    const toggle = await screen.findByRole("button", { name: /disable/i });
    act(() => { toggle.click(); toggle.click(); });
    await waitFor(() => expect(calls).toBe(1));
    expect(calls).toBe(1);
    await act(async () => { release(); });
  });
});
