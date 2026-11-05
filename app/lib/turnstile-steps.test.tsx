// @vitest-environment happy-dom
/**
 * The challenge widget across the steps of a multi-step form (the booking wizard and its embed).
 *
 * `useTurnstileWidget` re-runs when `step` changes, and its cleanup removes the widget it rendered. The wizard mounts the host element
 * only on its confirm step, so each visit to that step renders a fresh widget, and the widget of a step that was left is removed.
 * What must keep working is the submit: a token already held in the form's state is still there after a step change, so the submit that
 * reads it is not left waiting for a widget that has not answered yet.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useRef, useState } from "react";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { useTurnstileWidget } from "~/lib/turnstile";

type Opts = { callback: (token: string) => void };
let renders: Opts[];
let removed: string[];

beforeEach(() => {
  renders = [];
  removed = [];
  (window as unknown as { turnstile: unknown }).turnstile = {
    render: (_el: HTMLElement, opts: Opts) => { renders.push(opts); return `widget-${renders.length}`; },
    remove: (id: string) => { removed.push(id); },
  };
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  document.head.appendChild(script);
});
afterEach(() => {
  cleanup();
  document.head.querySelectorAll("script").forEach((el) => el.remove());
  delete (window as unknown as { turnstile?: unknown }).turnstile;
});

/** The wizard's shape: four steps, the widget host only on the last, a token held in state, a submit that reads it. */
function Wizard({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [step, setStep] = useState(0);
  const [token, setToken] = useState("");
  const host = useRef<HTMLDivElement>(null);
  useTurnstileWidget("1x00000000000000000000AA", host, step, setToken);
  return (
    <div>
      <button type="button" onClick={() => setStep(step + 1)}>next</button>
      <button type="button" onClick={() => setStep(step - 1)}>back</button>
      {step === 3 ? <div ref={host} data-testid="host" /> : null}
      <button type="button" onClick={() => onSubmit(token)}>submit</button>
    </div>
  );
}

const click = (view: ReturnType<typeof render>, name: string) => act(async () => { fireEvent.click(view.getByText(name)); });

describe("the challenge widget across form steps", () => {
  it("renders no widget before the step that has a host, then one on arrival", async () => {
    const view = render(<Wizard onSubmit={() => {}} />);
    for (let i = 0; i < 3; i += 1) await click(view, "next");
    expect(renders).toHaveLength(1);
    expect(view.getByTestId("host")).not.toBeNull();
  });

  it("keeps a solved token usable for the submit after leaving and returning, and renders a fresh widget on each return", async () => {
    const submitted: string[] = [];
    const view = render(<Wizard onSubmit={(t) => submitted.push(t)} />);
    for (let i = 0; i < 3; i += 1) await click(view, "next");
    await act(async () => { renders[0]!.callback("solved-token"); });
    // Leaving the step removes the widget of that step; the token held in state stays.
    await click(view, "back");
    expect(removed).toEqual(["widget-1"]);
    await click(view, "submit");
    expect(submitted).toEqual(["solved-token"]);
    // Returning mounts the host again and renders a new widget; the held token is still there until the new widget answers.
    await click(view, "next");
    expect(renders).toHaveLength(2);
    await click(view, "submit");
    expect(submitted).toEqual(["solved-token", "solved-token"]);
    await act(async () => { renders[1]!.callback("second-token"); });
    await click(view, "submit");
    expect(submitted.at(-1)).toBe("second-token");
  });
});

/** The same hook, with no host on any step: what a first visit looks like before the challenge script has loaded. */
function Plain({ show, options }: { show: boolean; options?: Parameters<typeof useTurnstileWidget>[4] }) {
  const host = useRef<HTMLDivElement>(null);
  const [, setToken] = useState("");
  useTurnstileWidget("1x00000000000000000000AA", host, 0, setToken, options);
  return show ? <div ref={host} /> : null;
}

describe("the challenge widget before and around the script loading", () => {
  it("renders once the script announces itself when window.turnstile was absent at mount, and not before", async () => {
    delete (window as unknown as { turnstile?: unknown }).turnstile;
    render(<Plain show />);
    expect(renders).toHaveLength(0);
    expect(typeof window.onTurnstileLoad).toBe("function");
    (window as unknown as { turnstile: unknown }).turnstile = {
      render: (_el: HTMLElement, opts: Opts) => { renders.push(opts); return "late-1"; },
      remove: (id: string) => { removed.push(id); },
    };
    await act(async () => { window.onTurnstileLoad!(); });
    expect(renders).toHaveLength(1);
    // Announcing twice does not render a second widget into the same host.
    await act(async () => { window.onTurnstileLoad!(); });
    expect(renders).toHaveLength(1);
  });

  it("renders nothing, and removes nothing, when the form goes away before the script has loaded", async () => {
    delete (window as unknown as { turnstile?: unknown }).turnstile;
    const view = render(<Plain show />);
    view.unmount();
    (window as unknown as { turnstile: unknown }).turnstile = {
      render: (_el: HTMLElement, opts: Opts) => { renders.push(opts); return "late-2"; },
      remove: (id: string) => { removed.push(id); },
    };
    // The load announcement of a form that is gone must neither render into nothing nor throw.
    await act(async () => { window.onTurnstileLoad?.(); });
    expect(renders).toHaveLength(0);
    expect(removed).toEqual([]);
  });

  it("copes with a render that returns no widget id: unmounting calls nothing", () => {
    (window as unknown as { turnstile: unknown }).turnstile = {
      render: (_el: HTMLElement, opts: Opts) => { renders.push(opts); return undefined; },
      remove: (id: string) => { removed.push(id); },
    };
    const view = render(<Plain show />);
    expect(renders).toHaveLength(1);
    view.unmount();
    expect(removed).toEqual([]);
  });

  it("hands the expired and error callbacks to the widget only when the caller gave them, and routes each to its own handler", async () => {
    const calls: string[] = [];
    type Wired = Opts & { "expired-callback"?: () => void; "error-callback"?: () => void };
    render(<Plain show options={{ onExpired: () => calls.push("expired"), onError: () => calls.push("error") }} />);
    const wired = renders[0] as Wired;
    wired["expired-callback"]!();
    wired["error-callback"]!();
    expect(calls).toEqual(["expired", "error"]);
    cleanup();
    renders.length = 0;
    render(<Plain show />);
    const bare = renders[0] as Wired;
    expect(bare["expired-callback"]).toBeUndefined();
    expect(bare["error-callback"]).toBeUndefined();
  });
});
