/**
 * The knowledge check in front of the signed audit export on the public verifier page.
 *
 * The verification result above it is public; the signed record lists every event with the emails given at signing, so it is released
 * to someone who can name an email recorded on the agreement or the postal code of the inspected property (either one is enough).
 * The request is a POST with the values in the body, never in a URL. Every refusal is shown as one neutral line, and a failed attempt
 * asks for a fresh bot-challenge token, because a token is good for one request: a download that went through uses its token up as
 * well, so the next one also waits for a new token. Where a site key is configured the button stays off until a token exists, and a
 * challenge that cannot load or has expired says so in its own line rather than reporting a mismatch.
 * lint:ds - only `ih-*` tokens.
 */
import { useRef, useState } from "react";
import { Banner, Button, Input, useActionLatch } from "@core/shared-ui";
import { useTurnstileWidget } from "~/lib/turnstile";
import { m } from "~/paraglide/messages";

type Phase = "idle" | "busy";

/** The filename the server gave the attachment, or a fallback made from the envelope id. */
function attachmentName(header: string | null, envelopeId: string): string {
  const match = header ? /filename="([^"]+)"/.exec(header) : null;
  return match?.[1] ?? `audit-${envelopeId.slice(0, 8)}.json`;
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function VerifyExportForm({ envelopeId, siteKey }: { envelopeId: string; siteKey: string | null }) {
  const [email, setEmail] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  // Set after a download went through; it sits outside the challenge host, so remounting the challenge does not touch it.
  const [done, setDone] = useState(false);
  // Counts the attempts that were refused: each one remounts the challenge host, which asks for a new token.
  const [attempt, setAttempt] = useState(0);
  const token = useRef("");
  const [hasToken, setHasToken] = useState(false);
  const widgetHost = useRef<HTMLDivElement | null>(null);
  const latch = useActionLatch(phase === "busy");

  const clearToken = () => { token.current = ""; setHasToken(false); };
  useTurnstileWidget(siteKey, widgetHost, attempt, (value) => {
    token.current = value;
    setHasToken(true);
    // The widget recovered by itself: the line that said it could not load no longer applies.
    setError((current) => (current === m.public_verify_export_error_challenge() ? null : current));
  }, {
    onLoadFailed: () => { clearToken(); setError(m.public_verify_export_error_challenge()); },
    onError: () => { clearToken(); setError(m.public_verify_export_error_challenge()); },
    onExpired: clearToken,
  });

  const send = async () => {
    if (!email.trim() && !postalCode.trim()) {
      setError(m.public_verify_export_error_required());
      return;
    }
    // A challenge that is configured but has no token yet cannot be answered; the button is off, and this covers a submit by other means.
    if (siteKey && !token.current) return;
    setPhase("busy");
    setError(null);
    setDone(false);
    try {
      const res = await fetch(`/api/public/verify/${encodeURIComponent(envelopeId)}/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(postalCode.trim() ? { postalCode: postalCode.trim() } : {}),
          ...(token.current ? { turnstileToken: token.current } : {}),
        }),
      });
      if (res.ok) {
        saveBlob(await res.blob(), attachmentName(res.headers.get("content-disposition"), envelopeId));
        setDone(true);
      } else {
        setError(
          res.status === 429 ? m.public_verify_export_error_locked()
            : res.status === 400 ? m.public_verify_export_error_invalid()
              : res.status === 503 ? m.public_verify_export_error_service()
                : m.public_verify_export_error_failed(),
        );
      }
      // The token was spent by this request whatever the answer, so the next one needs a new challenge.
      clearToken();
      setAttempt((n) => n + 1);
    } catch {
      setError(m.public_verify_export_error_network());
      clearToken();
      setAttempt((n) => n + 1);
    } finally {
      setPhase("idle");
    }
  };

  return (
    <form
      className="mt-6 p-3 rounded-lg border border-ih-border space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        latch(send);
      }}
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ih-fg-3">{m.public_verify_export_heading()}</h2>
      <p className="text-[13px] text-ih-fg-2">{m.public_verify_export_intro()}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          id="verify-export-email"
          type="email"
          autoComplete="off"
          maxLength={254}
          label={m.public_verify_export_email_label()}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          id="verify-export-postal"
          type="text"
          autoComplete="off"
          maxLength={20}
          label={m.public_verify_export_postal_label()}
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
        />
      </div>
      <p className="text-[11px] text-ih-fg-3">{m.public_verify_export_either()}</p>
      {siteKey ? <div key={attempt} ref={widgetHost} /> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {done ? <Banner tone="success">{m.public_verify_export_done()}</Banner> : null}
      <Button type="submit" variant="primary" pending={phase === "busy"} disabled={!!siteKey && !hasToken}>
        {phase === "busy" ? m.public_verify_export_submitting() : m.public_verify_export_submit()}
      </Button>
    </form>
  );
}
