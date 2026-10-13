// @vitest-environment happy-dom
// Two clicks on "Export to Word" dispatched in ONE act() queue one export job. The pending button
// only goes inert after a render, which is too late for the second event.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { WordExportButton } from "./WordExportButton";

afterEach(cleanup);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

function mount(action: () => unknown) {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <WordExportButton inspectionId="insp-1" pollIntervalMs={60_000} />, action },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

describe("WordExportButton latch", () => {
  it("queues ONE export for two same-frame clicks, and again from the retry button", async () => {
    // A failed enqueue shows the retry button, whose click must go through again.
    const action = vi.fn(async () => ({ ok: false, intent: "export-word-enqueue", error: "boom" }));
    mount(action);
    const start = screen.getByTestId("word-export-button");
    act(() => { start.click(); start.click(); });
    await settle();
    expect(action).toHaveBeenCalledTimes(1);

    act(() => { screen.getByTestId("word-export-retry").click(); });
    await settle();
    expect(action).toHaveBeenCalledTimes(2);
  });
});
