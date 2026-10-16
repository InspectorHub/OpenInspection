// @vitest-environment happy-dom
/**
 * The Built-in / Your own choice on a service page.
 */
import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { SourceChoice } from "./SourceChoice";

afterEach(cleanup);

function Harness({ available = ["provided", "own"], initial = "provided", error = null }: {
  available?: Array<"provided" | "own">;
  initial?: "provided" | "own";
  error?: string | null;
}) {
  const [selected, setSelected] = useState<"provided" | "own">(initial);
  return (
    <SourceChoice
      available={available}
      selected={selected}
      onSelect={setSelected}
      saving={false}
      error={error}
      saved={false}
    />
  );
}

function renderChoice(props: Parameters<typeof Harness>[0] = {}, action: () => unknown = () => null) {
  const Stub = createRoutesStub([{ path: "/x", Component: () => <Harness {...props} />, action }]);
  return render(<Stub initialEntries={["/x"]} />);
}

describe("SourceChoice", () => {
  it("offers Built-in and Your own, with the current one selected", async () => {
    renderChoice({ initial: "own" });
    const builtIn = (await screen.findByRole("radio", { name: /Built-in/ })) as HTMLInputElement;
    const own = screen.getByRole("radio", { name: /Your own/ }) as HTMLInputElement;
    expect(own.checked).toBe(true);
    expect(builtIn.checked).toBe(false);
    expect(builtIn.disabled).toBe(false);
  });

  it("shows Built-in as not available and cannot select it when it is not on offer, while Your own works", async () => {
    renderChoice({ available: ["own"], initial: "own" });
    const builtIn = (await screen.findByRole("radio", { name: /Built-in/ })) as HTMLInputElement;
    expect(builtIn.disabled).toBe(true);
    expect(screen.getByText("Not available yet")).toBeTruthy();
    // control: with Built-in open it is enabled and carries no badge
    cleanup();
    renderChoice({});
    expect(((await screen.findByRole("radio", { name: /Built-in/ })) as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText("Not available yet")).toBeNull();
  });

  it("posts the selected source, carrying no key", async () => {
    let posted: FormData | null = null;
    const Stub = createRoutesStub([{
      path: "/y",
      Component: () => <Harness initial="provided" />,
      action: async ({ request }) => { posted = await request.formData(); return null; },
    }]);
    render(<Stub initialEntries={["/y"]} />);
    (await screen.findByRole("radio", { name: /Your own/ })).click();
    const save = await screen.findByRole("button", { name: "Save choice" });
    await act(async () => { save.click(); });
    await waitFor(() => expect(posted).not.toBeNull());
    const fields = Object.fromEntries((posted as unknown as FormData).entries());
    expect(fields).toMatchObject({ intent: "save-source", source: "own" });
    // The radio's own field is the only other thing in the body: no key, no account detail.
    expect(Object.keys(fields).sort()).toEqual(["_sourceRadio", "intent", "source"]);
  });

  it("posts once when Save is clicked twice in one frame", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const Stub = createRoutesStub([{
      path: "/z",
      Component: () => <Harness />,
      action: async () => { calls += 1; await new Promise<void>((resolve) => { release = resolve; }); return null; },
    }]);
    render(<Stub initialEntries={["/z"]} />);
    const save = await screen.findByRole("button", { name: "Save choice" });
    act(() => { save.click(); save.click(); });
    await waitFor(() => expect(calls).toBe(1));
    expect(calls).toBe(1);
    await act(async () => { release(); });
  });

  it("shows the error it is given, and the saved note", async () => {
    renderChoice({ error: "Add your own account details below first, then choose Your own." });
    expect(await screen.findByText(/Add your own account details below first/)).toBeTruthy();
  });
});
