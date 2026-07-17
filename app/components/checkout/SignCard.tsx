import { useState, useRef, useEffect, useCallback } from "react";
import { useFetcher } from "react-router";
import { SanitizedHtml } from "~/components/SanitizedHtml";
import {
    OnBehalfFields,
    onBehalfPayload,
    EMPTY_ON_BEHALF,
    type OnBehalfValue,
} from "~/components/agreements/OnBehalfFields";
import type { StepState } from "~/lib/checkout-steps";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/*  Step 1 — Sign card                                                 */
/* ------------------------------------------------------------------ */

export function SignCard({
    agreementName,
    content,
    signerName,
    progress,
    state,
    onSigned,
}: {
    agreementName: string;
    content: string;
    signerName: string;
    progress: { signed: number; total: number };
    state: StepState;
    onSigned: () => void;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [drawing, setDrawing] = useState(false);
    const [hasMark, setHasMark] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [onBehalf, setOnBehalf] = useState<OnBehalfValue>(EMPTY_ON_BEHALF);
    const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
    const submitting = fetcher.state !== "idle";

    // The sign POST is dispatched via useFetcher to THIS route's action, which
    // forwards to the public sign endpoint through the BFF api client.
    useEffect(() => {
        if (fetcher.state === "idle" && fetcher.data) {
            if (fetcher.data.ok) onSigned();
            else setErrorMsg(fetcher.data.error ?? m.checkout_sign_error_failed());
        }
    }, [fetcher.state, fetcher.data, onSigned]);

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

    // Sign POST goes through the route action (BFF) — never a client fetch.
    function submitSignature() {
        if (!hasMark) {
            setErrorMsg(m.checkout_sign_error_no_mark());
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
        // Post to this route's own action (default form action = current URL).
        fetcher.submit(fd, { method: "post" });
    }

    const isDone = state === "done" || state === "waiting";

    return (
        <section className="border-b border-ih-border">
            <div className="px-6 py-5 sm:px-8 border-b border-ih-border">
                <p className="text-[11px] font-bold uppercase tracking-widest text-ih-fg-4">{m.checkout_sign_step_label()}</p>
                <h2 className="text-[15px] font-bold text-ih-fg-1 mt-0.5">{agreementName}</h2>
                {progress.total > 1 && (
                    <p className="text-[12px] text-ih-fg-3 mt-0.5">
                        {m.checkout_sign_signature_progress({ current: Math.min(progress.signed + (isDone ? 0 : 1), progress.total), total: progress.total })}
                    </p>
                )}
            </div>

            {/* Snapshot content (scrollable) */}
            <div className="px-6 py-5 sm:px-8 border-b border-ih-border max-h-72 overflow-y-auto">
                <SanitizedHtml
                    className="prose prose-sm max-w-none text-ih-fg-3 leading-relaxed"
                    html={content}
                />
            </div>

            {isDone ? (
                <div className="px-6 py-6 sm:px-8 text-center">
                    <div className="w-12 h-12 bg-ih-ok-bg rounded-full flex items-center justify-center mx-auto mb-3">
                        <svg className="w-6 h-6 text-ih-ok-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <h3 className="text-[15px] font-bold text-ih-fg-1">{m.checkout_sign_done_heading()}</h3>
                    {state === "waiting" ? (
                        <p className="text-[13px] text-ih-fg-3 mt-1">
                            {m.checkout_sign_waiting_body({
                                signerName,
                                plural: progress.total - progress.signed > 1 ? "s" : "",
                                signed: progress.signed,
                                total: progress.total,
                            })}
                        </p>
                    ) : (
                        <p className="text-[13px] text-ih-fg-3 mt-1">{m.checkout_sign_thankyou({ signerName })}</p>
                    )}
                </div>
            ) : (
                <div className="px-6 py-5 sm:px-8">
                    <p className="text-sm font-bold text-ih-fg-3 mb-3">{m.checkout_sign_draw_prompt()}</p>
                    <div
                        className="border-2 border-ih-border rounded-2xl overflow-hidden bg-ih-bg-app mb-3"
                        style={{ touchAction: "none" }}
                    >
                        <canvas
                            ref={canvasRef}
                            role="img"
                            aria-label={m.checkout_sign_canvas_aria()}
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

                    <div className="flex gap-3 mt-4">
                        <button
                            type="button"
                            onClick={clearSig}
                            disabled={submitting}
                            className="flex-1 h-10 px-4 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-3 text-sm font-semibold hover:bg-ih-bg-muted transition-all disabled:opacity-50"
                        >
                            {m.common_clear()}
                        </button>
                        <button
                            type="button"
                            onClick={submitSignature}
                            disabled={submitting}
                            className="flex-[2] h-10 px-4 bg-ih-primary text-ih-primary-fg rounded-md font-bold text-sm hover:bg-ih-primary-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {submitting ? m.checkout_sign_submit_pending() : m.checkout_sign_submit()}
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
}
