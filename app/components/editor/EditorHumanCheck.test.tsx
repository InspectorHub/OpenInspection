// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("~/lib/turnstile", () => ({ useTurnstileWidget: () => undefined }));

import { EditorHumanCheck } from "./EditorHumanCheck";
import { useEnsureHuman } from "~/components/OutboundVerification";

function Publish({ onResult }: { onResult: (ok: boolean) => void }) {
  const ensureHuman = useEnsureHuman();
  return <button type="button" onClick={async () => onResult(await ensureHuman())}>publish</button>;
}

const click = async () => { await act(async () => { fireEvent.click(screen.getByText("publish")); }); };

describe("EditorHumanCheck", () => {
  it("makes a publish inside a new company's window ask for the check", async () => {
    const onResult = vi.fn();
    render(
      <EditorHumanCheck coolingWindow={{ unlockAtMs: Date.now() + 3_600_000, turnstileSiteKey: "k" }}>
        <Publish onResult={onResult} />
      </EditorHumanCheck>,
    );
    await click();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onResult).not.toHaveBeenCalled();
  });

  it("lets a publish through at once when there is no window", async () => {
    const onResult = vi.fn();
    render(
      <EditorHumanCheck coolingWindow={null}>
        <Publish onResult={onResult} />
      </EditorHumanCheck>,
    );
    await click();
    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
