import { useState, useRef, useEffect, useCallback } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/agreement-sign";
import { createApi } from "~/lib/api-client.server";
import { SanitizedHtml } from "~/components/SanitizedHtml";
import {
    OnBehalfFields,
    onBehalfPayload,
    EMPTY_ON_BEHALF,
    type OnBehalfValue,
} from "~/components/agreements/OnBehalfFields";

export function meta() {
    return [{ title: "Sign Agreement - OpenInspection" }];
}

type SignerStatus = "pending" | "sent" | "viewed" | "signed" | "declined" | "expired";

/** Wire shape of GET /api/public/agreements/:token (Track I-a multi-signer). */
interface AgreementData {
    status: SignerStatus;
    clientName: string | null;
    agreementName: string;
    agreementContent: string;
    signer: { name: string; role: "client" | "co_client" | "agent" | "other"; status: SignerStatus };
    progress: { signed: number; total: number };
    completionPolicy: "all" | "one";
}

export async function loader({ params, context }: Route.LoaderArgs) {
    try {
        const api = createApi(context);
        // The public agreement fetch lives on the bookings router (GET
        // /api/public/agreements/:token); tenant resolves from the slug server-side.
        const res = (await api.bookings.agreements[":token"].$get({
            param: { token: params.token ?? "" },
        })) as unknown as Response;
        const body = res.ok ? ((await res.json()) as { data?: AgreementData }) : {};
        const d = (body as { data?: AgreementData }).data ?? null;
        return {
            agreement: d,
            error: res.ok ? null : "Agreement not found",
            token: params.token ?? "",
            tenant: params.tenant ?? "",
        };
    } catch {
        return { agreement: null, error: "Service unavailable", token: "", tenant: "" };
    }
}

/* ------------------------------------------------------------------ */
/*  Action — sign / decline via the BFF api client (no client fetch)   */
/* ------------------------------------------------------------------ */

export async function action({ request, params, context }: Route.ActionArgs) {
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    const api = createApi(context);
    const token = params.token ?? "";

    if (intent === "sign") {
        const signatureBase64 = String(form.get("signatureBase64") ?? "");
        if (!signatureBase64) return { ok: false, intent, error: "Signature is required." };
        const onBehalfOf = form.get("onBehalfOf");
        const onBehalfDisclaimer = form.get("onBehalfDisclaimer");
        const res = (await api.bookings.agreements[":token"].sign.$post({
            param: { token },
            json: {
                signatureBase64,
                ...(onBehalfOf ? { onBehalfOf: String(onBehalfOf) } : {}),
                ...(onBehalfDisclaimer ? { onBehalfDisclaimer: String(onBehalfDisclaimer) } : {}),
            },
        })) as unknown as Response;
        if (res.ok) return { ok: true, intent };
        const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return { ok: false, intent, error: d?.error?.message ?? "Signing failed. Please try again." };
    }

    if (intent === "decline") {
        const reason = form.get("reason");
        const res = (await api.bookings.agreements[":token"].decline.$post({
            param: { token },
            json: { ...(reason ? { reason: String(reason) } : {}) },
        })) as unknown as Response;
        if (res.ok) return { ok: true, intent };
        const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return { ok: false, intent, error: d?.error?.message ?? "Failed to decline. Please try again." };
    }

    return { ok: false, intent, error: "Unknown action." };
}

type ActionResult = { ok?: boolean; intent?: string; error?: string };

export default function AgreementSignPage() {
    const { agreement, error } = useLoaderData<typeof loader>();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [drawing, setDrawing] = useState(false);
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

    /* Canvas drawing helpers */
    const getPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const r = canvas.getBoundingClientRect();
        const src = "touches" in e ? e.touches[0] : e;
        return {
            x: (src.clientX - r.left) * (canvas.width / r.width),
            y: (src.clientY - r.top) * (canvas.height / r.height),
        };
    }, []);

    useEffect(() => {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        ctx.strokeStyle = "#1e293b";
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
    }, []);

    const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
        setDrawing(true);
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        const p = getPos(e);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
    };
    const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (!drawing) return;
        setHasMark(true);
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        const p = getPos(e);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
    };
    const handleEnd = () => setDrawing(false);
    const clearSig = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setHasMark(false);
    };

    const submitSignature = () => {
        if (!hasMark) {
            setErrorMsg("Please draw your signature before submitting.");
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) return;
        const signatureBase64 = canvas.toDataURL("image/png");
        const payload = onBehalfPayload(onBehalf);
        setErrorMsg(null);
        const fd = new FormData();
        fd.set("intent", "sign");
        fd.set("signatureBase64", signatureBase64);
        if (payload.onBehalfOf) fd.set("onBehalfOf", payload.onBehalfOf);
        if (payload.onBehalfDisclaimer) fd.set("onBehalfDisclaimer", payload.onBehalfDisclaimer);
        signFetcher.submit(fd, { method: "post" });
    };

    const submitDecline = () => {
        setErrorMsg(null);
        const fd = new FormData();
        fd.set("intent", "decline");
        if (declineReason) fd.set("reason", declineReason);
        declineFetcher.submit(fd, { method: "post" });
    };

    if (error || !agreement) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-ih-bg-app">
                <div className="text-center p-8">
                    <h1 className="text-2xl font-bold text-ih-fg-1">Agreement Not Found</h1>
                    <p className="text-ih-fg-3 mt-2">{error ?? "This agreement link is invalid or expired."}</p>
                </div>
            </div>
        );
    }

    if (declined) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-ih-bg-app">
                <div className="text-center p-8 max-w-md">
                    <h1 className="text-xl font-bold text-ih-fg-1">Thank you</h1>
                    <p className="text-ih-fg-3 mt-2">
                        The inspector has been notified that you declined this agreement.
                    </p>
                </div>
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
        <div className="min-h-screen bg-ih-bg-app py-6 px-4">
            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-ih-primary rounded-2xl flex items-center justify-center shadow-ih-popover">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <span className="text-xl font-bold tracking-tight text-ih-fg-1">OpenInspection</span>
                </div>

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
                                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-ih-primary text-white text-sm font-bold hover:bg-ih-primary-600 transition-all"
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

                            <div className="border-2 border-ih-border rounded-2xl overflow-hidden bg-ih-bg-app mb-2" style={{ touchAction: "none" }}>
                                <canvas
                                    ref={canvasRef}
                                    role="img"
                                    aria-label="Signature pad — draw your signature here"
                                    width={580}
                                    height={180}
                                    className="w-full cursor-crosshair block"
                                    onMouseDown={handleStart}
                                    onMouseMove={handleMove}
                                    onMouseUp={handleEnd}
                                    onMouseLeave={handleEnd}
                                    onTouchStart={handleStart}
                                    onTouchMove={handleMove}
                                    onTouchEnd={handleEnd}
                                />
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
                                    onClick={clearSig}
                                    disabled={submitting}
                                    className="flex-1 h-10 px-4 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-3 text-sm font-semibold hover:bg-ih-bg-muted transition-all disabled:opacity-50"
                                >
                                    Clear
                                </button>
                                <button
                                    type="button"
                                    onClick={submitSignature}
                                    disabled={submitting}
                                    className="flex-[2] h-10 px-4 bg-ih-primary text-white rounded-md font-bold text-sm hover:bg-ih-primary-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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

                <p className="text-center text-[11px] text-ih-fg-4 mt-6">Powered by OpenInspection</p>
            </div>
        </div>
    );
}
