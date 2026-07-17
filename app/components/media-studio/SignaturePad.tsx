import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  initialSignatureState,
  signatureReducer,
  strokeWidth,
  type Stroke,
  type StrokePoint,
} from "./signaturePad.logic";
import { m } from "~/paraglide/messages";

/** Ink color for the signature (matches the proto `--ink`). */
const INK = "#1e293b";
/** CSS height of the pad in px. Width is fluid (100%). */
const PAD_CSS_HEIGHT = 200;

/** Imperative handle the host page uses at submit time. */
export interface SignaturePadHandle {
  /** PNG data-URL at *device* resolution, or "" when empty. */
  toDataURL: () => string;
  isEmpty: () => boolean;
  clear: () => void;
}

interface SignaturePadProps {
  /** Disable input + buttons while the parent is submitting. */
  disabled?: boolean;
  /** Fired on the empty→non-empty / non-empty→empty edge so the host can gate its submit button. */
  onMarkChange?: (hasMark: boolean) => void;
  /** Accessible label for the canvas. */
  ariaLabel?: string;
}

/**
 * Reusable signature canvas — a shared sub-component of the Image/Media Studio.
 *
 * Reuses the same canvas primitives as PhotoAnnotator: devicePixelRatio scaling so the
 * exported PNG is crisp on retina/tablet, PointerEvent capture (mouse/touch/pen unified;
 * pen pressure drives stroke width; getCoalescedEvents for smooth capture), and a
 * per-stroke stroke-stack with session-level Undo / Redo / Clear.
 *
 * The committed strokes live in a useReducer (the pure signatureReducer); the live stroke
 * is a ref so high-frequency pointermove does not thrash React state. Export is at device
 * resolution via the imperative ref — the host page reads the PNG exactly where it used to
 * call canvas.toDataURL().
 */
export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(function SignaturePad(
  { disabled = false, onMarkChange, ariaLabel = m.media_signature_aria() },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const dprRef = useRef(1);
  // Live (in-progress) stroke; kept in a ref to avoid re-rendering on every pointermove.
  const curRef = useRef<Stroke | null>(null);

  const [state, dispatch] = useReducer(signatureReducer, initialSignatureState);
  const [penLabel, setPenLabel] = useState(m.media_signature_pen_mouse_touch());
  const [isPen, setIsPen] = useState(false);

  const hasMark = state.strokes.length > 0;

  /* -------------------------------------------------------------- */
  /* Drawing primitives (CSS-px space; ctx is pre-transformed by dpr) */
  /* -------------------------------------------------------------- */
  const drawStroke = useCallback((ctx: CanvasRenderingContext2D, s: Stroke) => {
    const pts = s.pts;
    if (pts.length === 0) return;
    if (pts.length < 2) {
      // a single tap → a dot
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, strokeWidth(s.pen, pts[0].p) / 2, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
      return;
    }
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = INK;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      ctx.beginPath();
      ctx.lineWidth = strokeWidth(s.pen, (a.p + b.p) / 2);
      ctx.moveTo(a.x, a.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      ctx.quadraticCurveTo(a.x, a.y, mx, my);
      ctx.stroke();
    }
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // clearRect is in device px (transform applies to drawing, not clear extents).
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    for (const s of state.strokes) drawStroke(ctx, s);
    if (curRef.current) drawStroke(ctx, curRef.current);
  }, [state.strokes, drawStroke]);

  /* -------------------------------------------------------------- */
  /* fit(): size the backing store to device px, draw in CSS px       */
  /* -------------------------------------------------------------- */
  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    dprRef.current = dpr;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    // Draw in CSS px, render at device resolution → crisp on retina/tablet.
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }, [redraw]);

  useEffect(() => {
    // Mount-only: size the backing store once and bind the resize listener.
    // Intentionally empty deps — `fit` re-binds as strokes change, but we only
    // want the listener registered once; the committed-stack effect below owns
    // the per-change redraw.
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Redraw whenever the committed stack changes (undo/redo/clear/commit).
  useEffect(() => {
    redraw();
  }, [redraw]);

  // Notify the host on the hasMark edge so it can gate its submit button.
  useEffect(() => {
    onMarkChange?.(hasMark);
  }, [hasMark, onMarkChange]);

  /* -------------------------------------------------------------- */
  /* Pointer → CSS-px point                                          */
  /* -------------------------------------------------------------- */
  const pointFrom = useCallback((e: PointerEvent | React.PointerEvent): StrokePoint => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    return { x: e.clientX - r.left, y: e.clientY - r.top, p: pressure };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      e.preventDefault();
      canvasRef.current?.setPointerCapture(e.pointerId);
      const pen = e.pointerType === "pen";
      setIsPen(pen);
      setPenLabel(pen ? m.media_signature_pen_pressure() : e.pointerType === "touch" ? m.media_signature_pen_touch() : m.media_signature_pen_mouse_touch());
      curRef.current = { pen, pts: [pointFrom(e)] };
      redraw();
    },
    [disabled, pointFrom, redraw],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!curRef.current) return;
      e.preventDefault();
      // Coalesced events → smoother high-frequency capture between paint frames.
      const native = e.nativeEvent;
      const evs =
        typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [native];
      for (const ev of evs) curRef.current.pts.push(pointFrom(ev));
      redraw();
    },
    [pointFrom, redraw],
  );

  const endStroke = useCallback(() => {
    const cur = curRef.current;
    if (!cur) return;
    curRef.current = null;
    dispatch({ type: "commit", stroke: cur });
  }, []);

  const onPointerLeave = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!curRef.current) return;
      curRef.current.pts.push(pointFrom(e));
      endStroke();
    },
    [pointFrom, endStroke],
  );

  /* -------------------------------------------------------------- */
  /* Imperative handle for the host page                             */
  /* -------------------------------------------------------------- */
  useImperativeHandle(
    ref,
    (): SignaturePadHandle => ({
      toDataURL: () =>
        hasMark && canvasRef.current ? canvasRef.current.toDataURL("image/png") : "",
      isEmpty: () => !hasMark,
      clear: () => {
        curRef.current = null;
        dispatch({ type: "clear" });
      },
    }),
    [hasMark],
  );

  const canUndo = state.strokes.length > 0;
  const canRedo = state.redo.length > 0;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-ih-fg-3">{m.media_signature_heading()}</span>
        <span
          className={`ml-auto font-mono text-[10px] font-bold px-2 py-0.5 rounded-md ${
            isPen ? "bg-ih-ok-bg text-ih-ok-fg" : "bg-ih-bg-muted text-ih-fg-4"
          }`}
        >
          {penLabel}
        </span>
      </div>

      <div
        ref={padRef}
        className="relative border-2 border-ih-border-strong rounded-xl overflow-hidden bg-ih-bg-card"
        style={{ touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={ariaLabel}
          className="block w-full cursor-crosshair"
          style={{ height: PAD_CSS_HEIGHT, touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={onPointerLeave}
        />
        {/* baseline + "sign here" hint, hidden once dirty */}
        <div className="pointer-events-none absolute left-6 right-6 bottom-12 border-b-2 border-dotted border-ih-fg-4/60" />
        {!hasMark && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-ih-fg-4/70 text-[15px] italic">
            {m.media_signature_hint()}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={() => dispatch({ type: "undo" })}
          disabled={disabled || !canUndo}
          className="h-11 px-3.5 inline-flex items-center gap-1.5 rounded-lg border border-ih-border-strong bg-ih-bg-card text-[13px] font-semibold text-ih-fg-2 hover:border-ih-primary hover:text-ih-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 14L4 9l5-5M4 9h11a5 5 0 015 5v0a5 5 0 01-5 5H9" />
          </svg>
          {m.common_undo()}
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "redo" })}
          disabled={disabled || !canRedo}
          className="h-11 px-3.5 inline-flex items-center gap-1.5 rounded-lg border border-ih-border-strong bg-ih-bg-card text-[13px] font-semibold text-ih-fg-2 hover:border-ih-primary hover:text-ih-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 14l5-5-5-5M20 9H9a5 5 0 00-5 5v0a5 5 0 005 5h6" />
          </svg>
          {m.common_redo()}
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "clear" })}
          disabled={disabled || !canUndo}
          className="h-11 px-3.5 inline-flex items-center gap-1.5 rounded-lg border border-ih-border-strong bg-ih-bg-card text-[13px] font-semibold text-ih-fg-2 hover:border-ih-primary hover:text-ih-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 7h14M10 7V5a1 1 0 011-1h2a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" />
          </svg>
          {m.common_clear()}
        </button>
      </div>
    </div>
  );
});
