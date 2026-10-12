// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

let emitToken: ((t: string) => void) | null = null;
vi.mock("~/lib/turnstile", () => ({
  useTurnstileWidget: (_k: unknown, _r: unknown, _s: unknown, onToken: (t: string) => void) => {
    emitToken = onToken;
  },
}));

import { OutboundVerificationProvider, useChallengeOnRefusal, useEnsureHuman } from "./OutboundVerification";

function Probe({ onResult }: { onResult: (ok: boolean) => void }) {
  const ensureHuman = useEnsureHuman();
  return <button type="button" onClick={async () => onResult(await ensureHuman())}>send</button>;
}

const setup = (windowOpen: boolean, siteKey: string | null = "site-key") => {
  const onResult = vi.fn();
  render(
    <OutboundVerificationProvider windowOpen={windowOpen} siteKey={siteKey}>
      <Probe onResult={onResult} />
    </OutboundVerificationProvider>,
  );
  return onResult;
};

const click = async () => { await act(async () => { fireEvent.click(screen.getByText("send")); }); };

beforeEach(() => {
  emitToken = null;
  document.cookie = "oi-human-token=; Max-Age=0; Path=/";
});

describe("OutboundVerificationProvider", () => {
  it("resolves true at once, with no dialog, outside the cooling window", async () => {
    const onResult = setup(false);
    await click();
    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the challenge inside the window and resolves true once a token is solved, leaving it for the next request", async () => {
    const onResult = setup(true);
    await click();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onResult).not.toHaveBeenCalled();
    await act(async () => emitToken!("0.token-value-1234567890"));
    expect(onResult).toHaveBeenCalledWith(true);
    expect(document.cookie).toContain("oi-human-token=");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resolves false and stores nothing when the person cancels", async () => {
    const onResult = setup(true);
    await click();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancel" })); });
    expect(onResult).toHaveBeenCalledWith(false);
    expect(document.cookie).not.toContain("oi-human-token=0");
  });

  it("lets the server decide when there is no site key", async () => {
    const onResult = setup(true, null);
    await click();
    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tells the first caller 'not verified' when a second request replaces its dialog", async () => {
    const first = vi.fn();
    const second = vi.fn();
    function Two() {
      const ensureHuman = useEnsureHuman();
      return (
        <>
          <button type="button" onClick={async () => first(await ensureHuman())}>one</button>
          <button type="button" onClick={async () => second(await ensureHuman())}>two</button>
        </>
      );
    }
    render(
      <OutboundVerificationProvider windowOpen siteKey="site-key">
        <Two />
      </OutboundVerificationProvider>,
    );
    await act(async () => { fireEvent.click(screen.getByText("one")); });
    await act(async () => { fireEvent.click(screen.getByText("two")); });
    expect(first).toHaveBeenCalledWith(false);
    await act(async () => emitToken!("0.token-value-1234567890"));
    expect(second).toHaveBeenCalledWith(true);
  });
});

describe("useChallengeOnRefusal", () => {
  function Page({ data, resubmit }: { data?: { verifySiteKey?: string }; resubmit: () => void }) {
    return <div>{useChallengeOnRefusal(data, "idle", resubmit)}</div>;
  }

  it("shows nothing for a normal response", () => {
    render(<Page data={{}} resubmit={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the check for a refusal and sends again once it is passed", async () => {
    const resubmit = vi.fn();
    render(<Page data={{ verifySiteKey: "k" }} resubmit={resubmit} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => emitToken!("0.token-value-1234567890"));
    expect(resubmit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not send again when the person cancels", async () => {
    const resubmit = vi.fn();
    render(<Page data={{ verifySiteKey: "k" }} resubmit={resubmit} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancel" })); });
    expect(resubmit).not.toHaveBeenCalled();
  });
});
