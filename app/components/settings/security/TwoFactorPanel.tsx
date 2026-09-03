import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { Button, Input, Modal } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { RecoveryCodes } from "./RecoveryCodes";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";

interface TwoFactorPanelProps {
  totpEnabled?: boolean;
  recoveryCodesRemaining?: number | null;
}

type SetupPayload = { secret: string; qrCodeDataUri: string; recoveryCodes: string[] };
type ActionReply = { ok: boolean; intent?: unknown; error?: string; setup?: SetupPayload | null };

/**
 * Two-factor authentication, connected.
 *
 * Every control here was a `<button>` with no `onClick` while the five TOTP
 * endpoints behind them had existed since they were written — so the panel
 * announced that 2FA was available and nothing could switch it on.
 *
 * Four things this shape is deliberate about:
 *
 *  - requests go through `/resources/two-factor`, not `fetch('/api/...')`.
 *    A browser call to the API carries no session (token-relay BFF), so a
 *    client-side fetch would answer 401 whatever the user typed;
 *  - the recovery codes are shown AFTER verify succeeds and before anything
 *    closes. They are returned once and the server keeps only hashes, so an
 *    enrollment that finishes without showing them is a lockout with a delay
 *    on it;
 *  - disable and regenerate ask for the password AND a current code, because
 *    that is what those endpoints require. Asking for less would build a form
 *    whose only possible outcome is a rejection;
 *  - every state transition runs in an effect, never during render. An earlier
 *    draft called `revalidate()` while rendering.
 */
export function TwoFactorPanel({ totpEnabled, recoveryCodesRemaining }: TwoFactorPanelProps) {
  // Guarded rather than a raw `fetcher.submit`: every control here is a
  // mutation, and `fetcher.submit` disables nothing — both halves of a double
  // click run inside one render. Firing "Turn off 2FA" twice is the case that
  // matters, since the second call meets an account that no longer has a
  // second factor and answers with a rejection the person reads as their code
  // being wrong.
  const { submit, fetcher, busy } = useGuardedSubmit<ActionReply>();
  const revalidator = useRevalidator();

  // `null` is the resting panel; "codes" is the one-time display that follows a
  // successful enrollment or regeneration.
  const [step, setStep] = useState<null | "enroll" | "disable" | "regenerate" | "codes">(null);
  // Secret + codes from a setup or regenerate reply. In memory only: this is
  // the one moment they exist outside the server, and putting them anywhere
  // durable would defeat showing them once.
  const [payload, setPayload] = useState<SetupPayload | null>(null);

  const error = fetcher.data && fetcher.data.ok === false ? fetcher.data.error : undefined;

  // Each reply must be acted on once. Without this the effect re-runs on every
  // unrelated render and re-opens a dialog the person just dismissed.
  const handled = useRef<ActionReply | null>(null);

  useEffect(() => {
    const reply = fetcher.data;
    if (fetcher.state !== "idle" || !reply || handled.current === reply) return;
    handled.current = reply;
    if (!reply.ok) return;

    if (reply.intent === "setup" && reply.setup) {
      setPayload(reply.setup);
      return;
    }
    if (reply.intent === "verify") {
      // The codes came with the SETUP reply, which is why `payload` is still
      // held here — the verify response carries none.
      setStep(payload?.recoveryCodes.length ? "codes" : null);
      if (!payload?.recoveryCodes.length) revalidator.revalidate();
      return;
    }
    if (reply.intent === "regenerate" && reply.setup) {
      setPayload(reply.setup);
      setStep("codes");
      return;
    }
    if (reply.intent === "disable") {
      setPayload(null);
      setStep(null);
      revalidator.revalidate();
    }
  }, [fetcher.data, fetcher.state, payload, revalidator]);

  function post(intent: string, form?: HTMLFormElement) {
    // The hook takes a flat payload, not FormData, because it appends its own
    // idempotency field before submitting.
    const payload: Record<string, string> = { intent };
    if (form) {
      for (const [k, v] of new FormData(form).entries()) {
        if (typeof v === "string") payload[k] = v;
      }
    }
    submit(payload, { method: "post", action: "/resources/two-factor" });
  }

  function beginEnroll() {
    setPayload(null);
    setStep("enroll");
    post("setup");
  }

  /** Dismissing the codes is the end of the flow — only then is the panel stale. */
  function closeCodes() {
    setStep(null);
    setPayload(null);
    revalidator.revalidate();
  }

  return (
    <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${totpEnabled ? "bg-ih-ok-bg text-ih-ok-fg" : "bg-ih-bg-muted text-ih-fg-3"}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
            </svg>
          </div>
          <div>
            <p className="font-bold text-ih-fg-1 text-[13px]">{m.settings_2fa_heading()}</p>
            <p className="text-[11px] text-ih-fg-3">
              {totpEnabled ? m.settings_2fa_enabled() : m.settings_2fa_not_enabled()}
            </p>
            {totpEnabled && recoveryCodesRemaining != null && (
              <p className="text-[11px] text-ih-fg-3 mt-1">{m.settings_2fa_recovery_remaining({ count: recoveryCodesRemaining })}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!totpEnabled ? (
            <Button variant="primary" onClick={beginEnroll} disabled={busy}>
              {m.settings_2fa_enable()}
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => { setPayload(null); setStep("regenerate"); }} disabled={busy}>
                {m.settings_2fa_regenerate()}
              </Button>
              <Button variant="danger" onClick={() => setStep("disable")} disabled={busy}>
                {m.settings_2fa_disable()}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Enrollment ── */}
      <Modal open={step === "enroll"} onClose={() => setStep(null)} title={m.settings_2fa_setup_title()} size="lg">
        <form onSubmit={(e) => { e.preventDefault(); post("verify", e.currentTarget); }} className="space-y-4">
          <p className="text-[13px] text-ih-fg-2">{m.settings_2fa_setup_scan()}</p>
          {payload?.qrCodeDataUri ? (
            // No background class here on purpose: `server/lib/qr.ts` renders
            // an SVG whose first path is an opaque light plate, so the quiet
            // zone a scanner needs is already inside the image. A semantic
            // surface token would be worse than nothing — in dark mode it puts
            // a dark ground behind an image that is already opaque.
            <img src={payload.qrCodeDataUri} alt="" className="w-40 h-40 rounded-md border border-ih-border" />
          ) : null}
          {/* The key is offered as text as well as a QR: a desktop authenticator
              has no camera, and a QR alone strands it. */}
          <Input readOnly label={m.settings_2fa_setup_secret_label()} value={payload?.secret ?? ""} onFocus={(e) => e.currentTarget.select()} />
          <Input name="code" autoComplete="one-time-code" inputMode="numeric" label={m.settings_2fa_setup_code_label()} error={error} reserveErrorSpace />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setStep(null)}>{m.settings_2fa_cancel()}</Button>
            <Button type="submit" variant="primary" disabled={busy || !payload}>
              {busy ? m.settings_2fa_working() : m.settings_2fa_setup_confirm()}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Disable ── */}
      <Modal open={step === "disable"} onClose={() => setStep(null)} title={m.settings_2fa_disable_title()} size="lg">
        <form onSubmit={(e) => { e.preventDefault(); post("disable", e.currentTarget); }} className="space-y-4">
          <p className="text-[13px] text-ih-fg-2">{m.settings_2fa_disable_explain()}</p>
          <Input name="password" type="password" autoComplete="current-password" label={m.settings_2fa_password_label()} />
          <Input name="code" autoComplete="one-time-code" label={m.settings_2fa_code_label()} error={error} reserveErrorSpace />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setStep(null)}>{m.settings_2fa_cancel()}</Button>
            <Button type="submit" variant="danger" disabled={busy}>
              {busy ? m.settings_2fa_working() : m.settings_2fa_confirm_disable()}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Regenerate ── */}
      <Modal open={step === "regenerate"} onClose={() => setStep(null)} title={m.settings_2fa_regenerate_title()} size="lg">
        <form onSubmit={(e) => { e.preventDefault(); post("regenerate", e.currentTarget); }} className="space-y-4">
          <p className="text-[13px] text-ih-fg-2">{m.settings_2fa_regenerate_explain()}</p>
          <Input name="password" type="password" autoComplete="current-password" label={m.settings_2fa_password_label()} />
          <Input name="code" autoComplete="one-time-code" label={m.settings_2fa_code_label()} error={error} reserveErrorSpace />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setStep(null)}>{m.settings_2fa_cancel()}</Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? m.settings_2fa_working() : m.settings_2fa_confirm_regenerate()}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── The codes, once ── */}
      <RecoveryCodes open={step === "codes"} codes={payload?.recoveryCodes ?? []} onClose={closeCodes} />
    </section>
  );
}
