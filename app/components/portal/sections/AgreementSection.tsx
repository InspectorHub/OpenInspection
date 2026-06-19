/**
 * <AgreementSection> — the e-signature agreement UI, extracted from the standalone
 * route `app/routes/public/agreement-sign.tsx` so it can be rendered BOTH as a
 * standalone page AND inline inside the unified client-portal Hub (section ③,
 * "Agreement").
 *
 * Data-source-agnostic: receives everything via props (no `useLoaderData`). The
 * host (standalone route OR Hub route) supplies the loader result + the
 * `actionPath` the internal sign/decline fetchers must post to.
 *
 * Bare-content convention — renders the section content ONLY; the page chrome
 * (page background, brand header, footer) is supplied by the host.
 *
 * Action targeting — the two `useFetcher().submit(...)` calls explicitly target
 * `actionPath` so they always hit the agreement-sign route's action regardless of
 * which route the component is mounted under (critical when mounted inside the Hub
 * route, whose own action would otherwise be hit).
 *
 * SSR safety — the signature canvas (<SignaturePad>) only touches
 * `window.devicePixelRatio`/the canvas inside event handlers and `useEffect`
 * (its DPR-aware `fit()` runs client-only); nothing runs during render.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { useState, useRef, useEffect } from "react";
import { useFetcher } from "react-router";
import { SanitizedHtml } from "~/components/SanitizedHtml";
import { SignaturePad, type SignaturePadHandle } from "~/components/media-studio/SignaturePad";
import {
  OnBehalfFields,
  onBehalfPayload,
  EMPTY_ON_BEHALF,
  type OnBehalfValue,
} from "~/components/agreements/OnBehalfFields";

type SignerStatus = "pending" | "sent" | "viewed" | "signed" | "declined" | "expired";

/** Wire shape of GET /api/public/agreements/:token (Track I-a multi-signer). */
export interface AgreementData {
  status: SignerStatus;
  clientName: string | null;
  agreementName: string;
  agreementContent: string;
  signer: { name: string; role: "client" | "co_client" | "agent" | "other"; status: SignerStatus };
  progress: { signed: number; total: number };
  completionPolicy: "all" | "one";
}

type ActionResult = { ok?: boolean; intent?: string; error?: string };

// ---------------------------------------------------------------------------
// Pure adapter — exported for unit tests
// ---------------------------------------------------------------------------

/**
 * Pure adapter: collapses the various agreement shapes into a single mode.
 *   - signer.status 'signed'   → 'signed'
 *   - signer.status 'declined' → 'declined'
 *   - explicit `signed: true`  → 'signed'
 *   - otherwise, if there is an agreement to sign (a signUrl / non-terminal
 *     signer) → 'needs-signature'
 *   - nothing to sign → 'none'
 */
export function agreementSectionState(data: {
  signed?: boolean;
  status?: string;
  signer?: { status?: string };
  signUrl?: string;
}): { mode: "signed" | "needs-signature" | "declined" | "none" } {
  const signerStatus = data.signer?.status;
  if (signerStatus === "signed" || data.signed === true) return { mode: "signed" };
  if (signerStatus === "declined") return { mode: "declined" };
  // There is an agreement awaiting this recipient's signature when we have a
  // sign target (signUrl) or a non-terminal signer.
  if (data.signUrl || signerStatus) return { mode: "needs-signature" };
  return { mode: "none" };
}

// ---------------------------------------------------------------------------
// Section entry
// ---------------------------------------------------------------------------

export function AgreementSection({
  agreement,
  error,
  token,
  actionPath,
}: {
  agreement: AgreementData | null;
  error: string | null;
  /** Standalone host passes the tenant slug; kept for parity, not required inline. */
  tenant?: string;
  /** The recipient's OWN signer token. Empty/absent when not a signer. */
  token: string;
  /** Where sign/decline fetchers post (the agreement-sign route's action). */
  actionPath: string;
}) {
  const padRef = useRef<SignaturePadHandle>(null);
  const [hasMark, setHasMark] = useState(false);
  const [signed, setSigned] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [onBehalf, setOnBehalf] = useState<OnBehalfValue>(EMPTY_ON_BEHALF);

  const signFetcher = useFetcher<ActionResult>();
  const declineFetcher = useFetcher<ActionResult>();
  const submitting = signFetcher.state !== "idle" || declineFetcher.state !== "idle";

  useEffect(() => {
    if (signFetcher.state === "idle" && signFetcher.data) {
      if (signFetcher.data.ok) setSigned(true);
      else setErrorMsg(signFetcher.data.error ?? "Signing failed. Please try again.");
    }
  }, [signFetcher.state, signFetcher.data]);

  useEffect(() => {
    if (declineFetcher.state === "idle" && declineFetcher.data) {
      if (declineFetcher.data.ok) setDeclined(true);
      else setErrorMsg(declineFetcher.data.error ?? "Failed to decline. Please try again.");
    }
  }, [declineFetcher.state, declineFetcher.data]);

  const submitSignature = () => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) {
      setErrorMsg("Please draw your signature before submitting.");
      return;
    }
    const signatureBase64 = pad.toDataURL();
    const payload = onBehalfPayload(onBehalf);
    setErrorMsg(null);
    const fd = new FormData();
    fd.set("intent", "sign");
    fd.set("signatureBase64", signatureBase64);
    if (payload.onBehalfOf) fd.set("onBehalfOf", payload.onBehalfOf);
    if (payload.onBehalfDisclaimer) fd.set("onBehalfDisclaimer", payload.onBehalfDisclaimer);
    signFetcher.submit(fd, { method: "post", action: actionPath });
  };

  const submitDecline = () => {
    setErrorMsg(null);
    const fd = new FormData();
    fd.set("intent", "decline");
    if (declineReason) fd.set("reason", declineReason);
    declineFetcher.submit(fd, { method: "post", action: actionPath });
  };

  // No token (recipient is not a signer) or no agreement on file → graceful card.
  if (!token || error || !agreement) {
    return (
      <div className="max-w-xl mx-auto p-8 text-center">
        <h2 className="text-xl font-bold text-ih-fg-1 mb-2">
          {error && token ? "Agreement Not Found" : "No Agreement"}
        </h2>
        <p className="text-[14px] text-ih-fg-3">
          {error && token
            ? error
            : "No agreement requires your signature."}
        </p>
      </div>
    );
  }

  if (declined) {
    return (
      <div className="max-w-xl mx-auto p-8 text-center">
        <h2 className="text-xl font-bold text-ih-fg-1">Thank you</h2>
        <p className="text-ih-fg-3 mt-2">
          The inspector has been notified that you declined this agreement.
        </p>
      </div>
    );
  }

  const alreadySigned = agreement.signer.status === "signed";
  const progress = agreement.progress;
  const multiSigner = progress.total > 1;
  // 1-based index of this signer's slot for the "Signature X of Y" hint.
  const myIndex = alreadySigned || signed ? progress.signed : progress.signed + 1;
  const envelopeComplete =
    agreement.completionPolicy === "one"
      ? progress.signed >= 1
      : progress.total > 0 && progress.signed >= progress.total;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-ih-bg-card rounded-lg shadow-ih-popover overflow-hidden">
        {/* Title bar */}
        <div className="px-6 py-6 sm:px-10 sm:py-8 border-b border-ih-border">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-primary mb-2">Document for Signature</p>
          <h1 className="text-xl font-bold text-ih-fg-1 tracking-tight">{agreement.agreementName}</h1>
          <p className="text-[13px] text-ih-fg-3 mt-1">
            For {agreement.signer.name}
            {agreement.clientName && agreement.clientName !== agreement.signer.name && (
              <span> · {agreement.clientName}</span>
            )}
          </p>
          {multiSigner && (
            <p className="text-[12px] text-ih-fg-4 mt-1.5">
              Signature {Math.min(myIndex, progress.total)} of {progress.total}
              {agreement.completionPolicy === "one" && " · any one signature completes this"}
            </p>
          )}
        </div>

        {/* Agreement content */}
        <div className="px-6 py-6 sm:px-10 sm:py-8 border-b border-ih-border max-h-96 overflow-y-auto">
          <SanitizedHtml
            className="prose prose-sm max-w-none text-ih-fg-3 leading-relaxed"
            html={agreement.agreementContent}
          />
        </div>

        {/* Signature area */}
        {alreadySigned || signed ? (
          <div className="px-6 py-8 sm:px-10 sm:py-10 text-center">
            <div className="w-16 h-16 bg-ih-ok-bg rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-ih-ok-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold tracking-tight text-ih-fg-1 mb-2">
              {signed ? "Signed Successfully" : "Already Signed"}
            </h2>
            <p className="text-ih-fg-3 font-medium mb-6">
              {multiSigner && !envelopeComplete
                ? `Thank you. We're waiting on the other signer${progress.total - progress.signed > 1 ? "s" : ""} (${progress.signed} of ${progress.total} signed).`
                : "Thank you for signing this agreement."}
            </p>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-ih-primary text-ih-primary-fg text-sm font-bold hover:bg-ih-primary-600 transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download as PDF
            </button>
            <p className="text-[11px] text-ih-fg-4 italic mt-3">
              In the print dialog, choose &quot;Save as PDF&quot; as destination.
            </p>
          </div>
        ) : (
          <div className="px-6 py-6 sm:px-10 sm:py-8">
            <p className="text-sm font-bold text-ih-fg-3 mb-4">Draw your signature below:</p>

            <div className="mb-2">
              <SignaturePad ref={padRef} disabled={submitting} onMarkChange={setHasMark} />
            </div>

            <OnBehalfFields value={onBehalf} onChange={setOnBehalf} disabled={submitting} />

            {errorMsg && (
              <div className="mt-4 px-3 py-2 rounded-md bg-ih-bad-bg text-[13px] font-medium text-ih-bad-fg text-center">
                {errorMsg}
              </div>
            )}

            <div className="flex gap-3 mt-4 mb-6">
              <button
                type="button"
                onClick={submitSignature}
                disabled={submitting || !hasMark}
                className="w-full h-11 px-4 bg-ih-primary text-ih-primary-fg rounded-md font-bold text-sm hover:bg-ih-primary-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {signFetcher.state !== "idle" ? "Signing..." : "Sign Agreement"}
              </button>
            </div>

            {/* Decline section */}
            <div className="border-t border-ih-border pt-4">
              <button
                type="button"
                onClick={() => setShowDecline(!showDecline)}
                className="text-xs text-ih-bad-fg hover:underline font-semibold"
              >
                {showDecline ? "Cancel decline" : "Decline this agreement"}
              </button>
              {showDecline && (
                <div className="mt-3 p-4 bg-ih-bad-bg rounded-lg border border-ih-bad/30">
                  <label className="block text-[10px] font-bold text-ih-bad-fg uppercase tracking-widest mb-2">Reason (optional)</label>
                  <textarea
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-ih-bad bg-ih-bg-card text-sm text-ih-fg-1 focus:ring-2 focus:ring-ih-bad/30 outline-none"
                    placeholder="Let the inspector know why..."
                  />
                  <button
                    type="button"
                    onClick={submitDecline}
                    disabled={submitting}
                    className="mt-3 px-5 py-2 rounded-lg bg-ih-bad text-white text-[10px] font-bold uppercase tracking-widest hover:bg-ih-bad/85 transition disabled:opacity-50"
                  >
                    {declineFetcher.state !== "idle" ? "Submitting..." : "Decline Agreement"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
