import { useState, useRef, useEffect, useCallback } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/agreement-sign";
import { apiFetch } from "~/lib/api.server";

export function meta() {
 return [{ title: "Sign Agreement - OpenInspection" }];
}

interface AgreementData {
 title: string;
 body: string;
 clientName: string | null;
 inspectorName: string;
 signedAt: string | null;
}

export async function loader({ params }: Route.LoaderArgs) {
 try {
 const res = await apiFetch(
 `/api/public/agreements/sign/${params.tenant}/${params.token}`,
 );
 const body = res.ok ? await res.json() : {};
 const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
 return {
 agreement: (Object.keys(d).length > 0 ? d : null) as AgreementData | null,
 error: res.ok ? null : "Agreement not found",
 token: params.token,
 tenant: params.tenant,
 };
 } catch {
 return { agreement: null, error: "Service unavailable", token: "", tenant: "" };
 }
}

export default function AgreementSignPage() {
 const { agreement, error, token } = useLoaderData<typeof loader>();
 const canvasRef = useRef<HTMLCanvasElement>(null);
 const [drawing, setDrawing] = useState(false);
 const [hasMark, setHasMark] = useState(false);
 const [submitting, setSubmitting] = useState(false);
 const [signed, setSigned] = useState(false);
 const [declined, setDeclined] = useState(false);
 const [showDecline, setShowDecline] = useState(false);
 const [declineReason, setDeclineReason] = useState("");
 const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

 /* Initialize canvas context */
 useEffect(() => {
 const canvas = canvasRef.current;
 if (!canvas) return;
 const ctx = canvas.getContext("2d");
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
 if (!canvas) return;
 const ctx = canvas.getContext("2d");
 if (!ctx) return;
 ctx.clearRect(0, 0, canvas.width, canvas.height);
 setHasMark(false);
 };

 const submitSignature = async () => {
 if (!hasMark) {
 setErrorMsg("Please draw your signature before submitting.");
 return;
 }
 const canvas = canvasRef.current;
 if (!canvas) return;
 const signatureBase64 = canvas.toDataURL("image/png");
 setSubmitting(true);
 setErrorMsg(null);
 try {
 const res = await fetch(`/api/public/agreements/${token}/sign`, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ signatureBase64 }),
 });
 if (res.ok) {
 setSigned(true);
 } else {
 const d = await res.json().catch(() => ({}));
 setErrorMsg((d as any)?.error?.message || "Signing failed. Please try again.");
 }
 } catch {
 setErrorMsg("Network error. Please try again.");
 } finally {
 setSubmitting(false);
 }
 };

 const submitDecline = async () => {
 setSubmitting(true);
 setErrorMsg(null);
 try {
 const res = await fetch(`/api/public/agreements/${token}/decline`, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ reason: declineReason || undefined }),
 });
 if (res.ok) {
 setDeclined(true);
 } else {
 const d = await res.json().catch(() => ({}));
 setErrorMsg((d as any)?.error?.message || "Failed to decline. Please try again.");
 }
 } catch {
 setErrorMsg("Network error. Please try again.");
 } finally {
 setSubmitting(false);
 }
 };

 if (error || !agreement) {
 return (
 <div className="min-h-screen flex items-center justify-center bg-ih-bg-app">
 <div className="text-center p-8">
 <h1 className="text-2xl font-bold text-ih-fg-1">Agreement Not Found</h1>
 <p className="text-ih-fg-3 mt-2">
 {error ?? "This agreement link is invalid or expired."}
 </p>
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

 return (
 <div className="min-h-screen bg-ih-bg-app py-6 px-4">
 <div className="max-w-2xl mx-auto">
 {/* Header */}
 <div className="flex items-center gap-3 mb-6">
 <div className="w-10 h-10 bg-ih-primary rounded-2xl flex items-center justify-center shadow-lg">
 <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
 </svg>
 </div>
 <span className="text-xl font-bold tracking-tight text-ih-fg-1">
 OpenInspection
 </span>
 </div>

 <div className="bg-ih-bg-card rounded-lg shadow-md overflow-hidden">
 {/* Title bar */}
 <div className="px-6 py-6 sm:px-10 sm:py-8 border-b border-slate-100 dark:border-slate-700">
 <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-primary mb-2">Document for Signature</p>
 <h1 className="text-xl font-bold text-ih-fg-1 tracking-tight">{agreement.title}</h1>
 <p className="text-[13px] text-ih-fg-3 mt-1">
 From {agreement.inspectorName}
 {agreement.clientName && <span> to {agreement.clientName}</span>}
 </p>
 </div>

 {/* Agreement content */}
 <div className="px-6 py-6 sm:px-10 sm:py-8 border-b border-slate-100 dark:border-slate-700 max-h-96 overflow-y-auto">
 <div
 className="prose prose-sm dark:prose-invert max-w-none text-ih-fg-3 leading-relaxed"
 dangerouslySetInnerHTML={{ __html: agreement.body }}
 />
 </div>

 {/* Signature area */}
 {agreement.signedAt || signed ? (
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
 {signed ? "Thank you for signing this agreement." : `This agreement was signed on ${agreement.signedAt}.`}
 </p>
 <button
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

 {/* Signature canvas */}
 <div className="border-2 border-ih-border rounded-2xl overflow-hidden bg-ih-bg-app mb-4" style={{ touchAction: "none" }}>
 <canvas
 ref={canvasRef}
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

 {/* Error message */}
 {errorMsg && (
 <div className="mb-4 px-3 py-2 rounded-md bg-ih-bad-bg text-[13px] font-medium text-ih-bad-fg text-center">
 {errorMsg}
 </div>
 )}

 {/* Action buttons */}
 <div className="flex gap-3 mb-6">
 <button
 onClick={clearSig}
 className="flex-1 h-10 px-4 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-3 text-sm font-semibold hover:bg-ih-bg-muted transition-all"
 >
 Clear
 </button>
 <button
 onClick={submitSignature}
 disabled={submitting}
 className="flex-[2] h-10 px-4 bg-ih-primary text-white rounded-md font-bold text-sm hover:bg-ih-primary-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
 >
 {submitting ? "Signing..." : "Sign Agreement"}
 </button>
 </div>

 {/* Decline section */}
 <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
 <button
 onClick={() => setShowDecline(!showDecline)}
 className="text-xs text-ih-bad-fg hover:underline font-semibold"
 >
 {showDecline ? "Cancel decline" : "Decline this agreement"}
 </button>
 {showDecline && (
 <div className="mt-3 p-4 bg-ih-bad-bg rounded-lg border border-rose-100 dark:border-rose-800">
 <label className="block text-[10px] font-bold text-ih-bad-fg uppercase tracking-widest mb-2">Reason (optional)</label>
 <textarea
 value={declineReason}
 onChange={(e) => setDeclineReason(e.target.value)}
 rows={3}
 className="w-full px-3 py-2 rounded-lg border border-ih-bad bg-ih-bg-card text-sm text-ih-fg-1 focus:ring-2 focus:ring-rose-500/20 outline-none"
 placeholder="Let the inspector know why..."
 />
 <button
 onClick={submitDecline}
 disabled={submitting}
 className="mt-3 px-5 py-2 rounded-lg bg-rose-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-rose-700 transition disabled:opacity-50"
 >
 {submitting ? "Submitting..." : "Decline Agreement"}
 </button>
 </div>
 )}
 </div>
 </div>
 )}
 </div>

 <p className="text-center text-[11px] text-ih-fg-4 mt-6">
 Powered by OpenInspection
 </p>
 </div>
 </div>
 );
}
