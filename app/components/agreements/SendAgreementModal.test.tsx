// @vitest-environment happy-dom
/**
 * Two clicks on "Send" dispatched in one frame must reach `onSend` once. `busy`
 * is still false when the second click arrives, so the guard is a ref released
 * when the parent reports the send settled.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { SendAgreementModal } from "./SendAgreementModal";
import { m } from "~/paraglide/messages";

afterEach(cleanup);

const SIGNERS = [{ name: "Jane", email: "jane@test.com", role: "client" as const }];

function ui(onSend: () => void, busy: boolean) {
    return <SendAgreementModal open onSend={onSend} onClose={() => {}} busy={busy} initialSigners={SIGNERS} />;
}

const sendButton = () => screen.getByRole("button", { name: m.agreement_send_submit() });

describe("SendAgreementModal in-flight latch", () => {
    it("sends once for two same-frame clicks, and again after busy settles", () => {
        const onSend = vi.fn();
        const { rerender } = render(ui(onSend, false));
        const btn = sendButton();
        act(() => { btn.click(); btn.click(); });
        expect(onSend).toHaveBeenCalledTimes(1);

        rerender(ui(onSend, true));
        rerender(ui(onSend, false));
        act(() => { sendButton().click(); });
        expect(onSend).toHaveBeenCalledTimes(2);
    });

    it("reopens when the caller declines before submitting, so Send is not dead after a dismissed human check", async () => {
        // The caller awaits a human check before it submits; when that is dismissed nothing is submitted
        // and `busy` never rises. A latch that only waits for a busy change would swallow every later click.
        const onSend = vi.fn();
        render(ui(onSend, false));
        act(() => { sendButton().click(); });
        expect(onSend).toHaveBeenCalledTimes(1);
        await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
        act(() => { sendButton().click(); });
        expect(onSend).toHaveBeenCalledTimes(2);
    });
});
