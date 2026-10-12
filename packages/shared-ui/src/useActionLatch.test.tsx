// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";
import { useActionLatch } from "./useActionLatch";

afterEach(cleanup);

function Harness({ busy, onAction }: { busy: boolean; onAction: () => void }) {
  const once = useActionLatch(busy);
  return <button type="button" onClick={() => once(onAction)}>go</button>;
}

const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });

describe("useActionLatch", () => {
  it("drops the second of two same-task calls", () => {
    const onAction = vi.fn();
    render(<Harness busy={false} onAction={onAction} />);
    const btn = screen.getByRole("button");
    act(() => { btn.click(); btn.click(); });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("CONTROL - reopens one macrotask later for a caller that never raises busy", async () => {
    const onAction = vi.fn();
    render(<Harness busy={false} onAction={onAction} />);
    const btn = screen.getByRole("button");
    act(() => { btn.click(); });
    await wait();
    act(() => { btn.click(); });
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("reopens when busy goes true then false", async () => {
    const onAction = vi.fn();
    const { rerender } = render(<Harness busy={false} onAction={onAction} />);
    act(() => { screen.getByRole("button").click(); });
    rerender(<Harness busy onAction={onAction} />);
    rerender(<Harness busy={false} onAction={onAction} />);
    act(() => { screen.getByRole("button").click(); });
    expect(onAction).toHaveBeenCalledTimes(2);
  });
});
