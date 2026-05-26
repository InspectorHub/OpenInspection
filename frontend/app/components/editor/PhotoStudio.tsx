import { useState, useEffect, useCallback, useRef } from "react";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface Annotation {
  kind: "circle" | "arrow" | "label" | "freehand";
  x: number;
  y: number;
  r?: number;
  x2?: number;
  y2?: number;
  text?: string;
  points?: Array<{ x: number; y: number }>;
}

interface PhotoStudioProps {
  open: boolean;
  photoUrl: string | null;
  photoIndex?: number;
  totalPhotos?: number;
  sectionName?: string;
  onSave?: (data: { annotations: Annotation[]; caption: string }) => void;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/* Tool palette definition                                             */
/* ------------------------------------------------------------------ */

const TOOLS = [
  { id: "pan", label: "Pan", icon: "M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" },
  { id: "circle", label: "Circle", icon: "M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "arrow", label: "Arrow", icon: "M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" },
  { id: "free", label: "Draw", icon: "M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" },
  { id: "text", label: "Label", icon: "M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" },
  { id: "measure", label: "Measure", icon: "M3 3h18M3 3v18M3 3l18 18M3 9h6M3 15h3M9 3v6M15 3v3" },
] as const;

type ToolId = (typeof TOOLS)[number]["id"];

const ANNOTATION_COLOR = "#ef4444";

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function PhotoStudio({
  open,
  photoUrl,
  photoIndex,
  totalPhotos,
  sectionName,
  onSave,
  onClose,
}: PhotoStudioProps) {
  const [tool, setTool] = useState<ToolId>("circle");
  const [zoom, setZoom] = useState(1);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [caption, setCaption] = useState(sectionName || "");
  const [showCalibration, setShowCalibration] = useState(false);
  const [arrowStart, setArrowStart] = useState<{ x: number; y: number } | null>(null);
  const [freehandPoints, setFreehandPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [isDrawingFreehand, setIsDrawingFreehand] = useState(false);

  // Inline label input state (replaces window.prompt)
  const [labelInput, setLabelInput] = useState<{ x: number; y: number } | null>(null);
  const [labelText, setLabelText] = useState("");
  const labelInputRef = useRef<HTMLInputElement>(null);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setAnnotations([]);
      setCaption(sectionName || "");
      setZoom(1);
      setTool("circle");
      setArrowStart(null);
      setFreehandPoints([]);
      setIsDrawingFreehand(false);
      setLabelInput(null);
      setLabelText("");
      setShowCalibration(false);
    }
  }, [open, sectionName]);

  // Focus label input when it appears
  useEffect(() => {
    if (labelInput) {
      setTimeout(() => labelInputRef.current?.focus(), 50);
    }
  }, [labelInput]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // If label input is open, close it first
        if (labelInput) {
          setLabelInput(null);
          setLabelText("");
          return;
        }
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose, labelInput]);

  /* -------------------------------------------------------------- */
  /* Canvas coords helper                                            */
  /* -------------------------------------------------------------- */

  const toPercent = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 100,
        y: ((e.clientY - rect.top) / rect.height) * 100,
      };
    },
    [],
  );

  /* -------------------------------------------------------------- */
  /* Canvas click handler                                            */
  /* -------------------------------------------------------------- */

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Skip if label input is open
      if (labelInput) return;

      const { x, y } = toPercent(e);

      if (tool === "circle") {
        setAnnotations((prev) => [...prev, { kind: "circle", x, y, r: 5 }]);
      } else if (tool === "text") {
        setLabelInput({ x, y });
        setLabelText("");
      } else if (tool === "arrow") {
        if (!arrowStart) {
          setArrowStart({ x, y });
        } else {
          setAnnotations((prev) => [
            ...prev,
            { kind: "arrow", x: arrowStart.x, y: arrowStart.y, x2: x, y2: y },
          ]);
          setArrowStart(null);
        }
      } else if (tool === "measure") {
        setShowCalibration(true);
      }
    },
    [tool, arrowStart, toPercent, labelInput],
  );

  /* -------------------------------------------------------------- */
  /* Freehand drawing handlers                                       */
  /* -------------------------------------------------------------- */

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (tool !== "free" || labelInput) return;
      const { x, y } = toPercent(e);
      setFreehandPoints([{ x, y }]);
      setIsDrawingFreehand(true);
    },
    [tool, toPercent, labelInput],
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDrawingFreehand || tool !== "free") return;
      const { x, y } = toPercent(e);
      setFreehandPoints((prev) => [...prev, { x, y }]);
    },
    [isDrawingFreehand, tool, toPercent],
  );

  const handleCanvasMouseUp = useCallback(() => {
    if (!isDrawingFreehand || tool !== "free") return;
    if (freehandPoints.length > 1) {
      setAnnotations((prev) => [
        ...prev,
        {
          kind: "freehand",
          x: freehandPoints[0].x,
          y: freehandPoints[0].y,
          points: freehandPoints,
        },
      ]);
    }
    setFreehandPoints([]);
    setIsDrawingFreehand(false);
  }, [isDrawingFreehand, tool, freehandPoints]);

  /* -------------------------------------------------------------- */
  /* Label commit                                                    */
  /* -------------------------------------------------------------- */

  const commitLabel = useCallback(() => {
    if (labelInput && labelText.trim()) {
      setAnnotations((prev) => [
        ...prev,
        { kind: "label", x: labelInput.x, y: labelInput.y, text: labelText.trim() },
      ]);
    }
    setLabelInput(null);
    setLabelText("");
  }, [labelInput, labelText]);

  /* -------------------------------------------------------------- */
  /* Undo last annotation                                            */
  /* -------------------------------------------------------------- */

  const undoLast = useCallback(() => {
    setAnnotations((prev) => prev.slice(0, -1));
  }, []);

  /* -------------------------------------------------------------- */
  /* Save handler                                                    */
  /* -------------------------------------------------------------- */

  const handleSave = useCallback(() => {
    onSave?.({ annotations, caption });
  }, [annotations, caption, onSave]);

  /* -------------------------------------------------------------- */
  /* Zoom helpers                                                    */
  /* -------------------------------------------------------------- */

  const zoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.25, 4)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.25, 0.5)), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  /* -------------------------------------------------------------- */
  /* Render                                                          */
  /* -------------------------------------------------------------- */

  if (!open) return null;

  const cursorClass =
    tool === "pan"
      ? "cursor-move"
      : tool === "free"
        ? "cursor-crosshair"
        : "cursor-crosshair";

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{ background: "rgba(0,0,0,0.92)" }}
    >
      {/* -------------------------------------------------------- */}
      {/* Top bar                                                   */}
      {/* -------------------------------------------------------- */}
      <div
        className="flex items-center gap-3 px-4 h-14 flex-shrink-0"
        style={{
          background: "rgba(15,23,42,0.8)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-md flex items-center justify-center text-white/70 hover:bg-white/10 transition-colors"
          aria-label="Close photo studio"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Title */}
        <div className="flex-1 min-w-0 text-center">
          <span className="text-[14px] font-bold text-white/90">
            {photoIndex != null && totalPhotos != null && totalPhotos > 0
              ? `Photo ${photoIndex} of ${totalPhotos}`
              : "Photo Studio"}
          </span>
          {arrowStart && (
            <span className="block text-[11px] text-amber-400 font-medium">
              Click to set arrow endpoint
            </span>
          )}
          {tool === "free" && (
            <span className="block text-[11px] text-white/50">
              Click and drag to draw
            </span>
          )}
        </div>

        {/* AI Suggest placeholder */}
        <button
          className="h-8 px-3 rounded-md text-[12px] font-bold text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors flex items-center gap-1.5"
          title="AI Suggest (coming soon)"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
          AI Suggest
        </button>

        {/* Undo */}
        <button
          onClick={undoLast}
          disabled={annotations.length === 0}
          className="h-8 px-3 rounded-md text-[12px] font-bold text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
          title="Undo last annotation"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
          </svg>
          Undo
        </button>

        {/* Save */}
        <button
          onClick={handleSave}
          className="h-8 px-4 rounded-md bg-ih-primary text-white text-[12px] font-bold hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Save
        </button>
      </div>

      {/* -------------------------------------------------------- */}
      {/* Canvas area                                                */}
      {/* -------------------------------------------------------- */}
      <div className="flex-1 relative overflow-hidden">
        <div
          className={`absolute inset-0 flex items-center justify-center ${cursorClass}`}
          onClick={tool !== "free" ? handleCanvasClick : undefined}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        >
          {/* Photo or placeholder */}
          <div
            className="relative max-w-full max-h-full"
            style={{
              transform: `scale(${zoom})`,
              transition: "transform 150ms ease",
            }}
          >
            {photoUrl ? (
              <img
                src={photoUrl}
                alt="Inspection photo"
                className="max-w-full max-h-[calc(100vh-8rem)] object-contain select-none pointer-events-none"
                draggable={false}
              />
            ) : (
              <div
                className="w-[600px] h-[400px] rounded-lg flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.15) 100%)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div className="text-center text-white/40">
                  <svg className="w-12 h-12 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v14.25a1.5 1.5 0 001.5 1.5z" />
                  </svg>
                  <p className="text-[13px]">No photo selected</p>
                  <p className="text-[11px] mt-1">Take or upload a photo to annotate</p>
                </div>
              </div>
            )}

            {/* SVG annotation overlay */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {annotations.map((ann, i) => {
                if (ann.kind === "circle") {
                  return (
                    <circle
                      key={i}
                      cx={ann.x}
                      cy={ann.y}
                      r={ann.r || 5}
                      fill="none"
                      stroke={ANNOTATION_COLOR}
                      strokeWidth={0.4}
                    />
                  );
                }
                if (ann.kind === "arrow" && ann.x2 != null && ann.y2 != null) {
                  const dx = ann.x2 - ann.x;
                  const dy = ann.y2 - ann.y;
                  const len = Math.sqrt(dx * dx + dy * dy);
                  if (len === 0) return null;
                  const ux = dx / len;
                  const uy = dy / len;
                  const headLen = Math.min(2, len * 0.3);
                  const h1x = ann.x2 - headLen * ux + headLen * 0.4 * uy;
                  const h1y = ann.y2 - headLen * uy - headLen * 0.4 * ux;
                  const h2x = ann.x2 - headLen * ux - headLen * 0.4 * uy;
                  const h2y = ann.y2 - headLen * uy + headLen * 0.4 * ux;
                  return (
                    <g key={i}>
                      <line
                        x1={ann.x}
                        y1={ann.y}
                        x2={ann.x2}
                        y2={ann.y2}
                        stroke={ANNOTATION_COLOR}
                        strokeWidth={0.4}
                      />
                      <polyline
                        points={`${h1x},${h1y} ${ann.x2},${ann.y2} ${h2x},${h2y}`}
                        fill="none"
                        stroke={ANNOTATION_COLOR}
                        strokeWidth={0.4}
                      />
                    </g>
                  );
                }
                if (ann.kind === "freehand" && ann.points && ann.points.length > 1) {
                  const d = ann.points
                    .map((p, j) => `${j === 0 ? "M" : "L"}${p.x},${p.y}`)
                    .join(" ");
                  return (
                    <path
                      key={i}
                      d={d}
                      fill="none"
                      stroke={ANNOTATION_COLOR}
                      strokeWidth={0.3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  );
                }
                return null;
              })}

              {/* Active arrow preview line */}
              {arrowStart && (
                <circle
                  cx={arrowStart.x}
                  cy={arrowStart.y}
                  r={0.8}
                  fill={ANNOTATION_COLOR}
                />
              )}

              {/* Active freehand drawing */}
              {isDrawingFreehand && freehandPoints.length > 1 && (
                <path
                  d={freehandPoints
                    .map((p, j) => `${j === 0 ? "M" : "L"}${p.x},${p.y}`)
                    .join(" ")}
                  fill="none"
                  stroke={ANNOTATION_COLOR}
                  strokeWidth={0.3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.6}
                />
              )}
            </svg>

            {/* Label annotations rendered as positioned divs */}
            {annotations
              .filter((a) => a.kind === "label" && a.text)
              .map((ann, i) => (
                <div
                  key={`label-${i}`}
                  className="absolute pointer-events-none"
                  style={{
                    left: `${ann.x}%`,
                    top: `${ann.y}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <span
                    className="inline-block px-2 py-0.5 rounded text-[11px] font-bold text-white whitespace-nowrap"
                    style={{ backgroundColor: ANNOTATION_COLOR }}
                  >
                    {ann.text}
                  </span>
                </div>
              ))}

            {/* Inline label input (instead of window.prompt) */}
            {labelInput && (
              <div
                className="absolute z-10"
                style={{
                  left: `${labelInput.x}%`,
                  top: `${labelInput.y}%`,
                  transform: "translate(-50%, -120%)",
                }}
              >
                <div
                  className="bg-slate-800 rounded-lg border border-white/20 p-2 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    ref={labelInputRef}
                    type="text"
                    value={labelText}
                    onChange={(e) => setLabelText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitLabel();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setLabelInput(null);
                        setLabelText("");
                      }
                      e.stopPropagation();
                    }}
                    placeholder="Enter label..."
                    className="w-40 h-7 px-2 rounded bg-slate-700 text-white text-[12px] border border-white/10 outline-none focus:border-indigo-500 placeholder-white/30"
                  />
                  <div className="flex justify-end gap-1 mt-1.5">
                    <button
                      onClick={() => {
                        setLabelInput(null);
                        setLabelText("");
                      }}
                      className="px-2 py-0.5 rounded text-[10px] font-bold text-white/50 hover:text-white/80"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={commitLabel}
                      className="px-2 py-0.5 rounded text-[10px] font-bold text-white bg-indigo-600 hover:bg-indigo-700"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Zoom controls (right side) */}
        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-1">
          <button
            onClick={zoomIn}
            className="w-9 h-9 rounded-md bg-white/10 text-white/70 hover:bg-white/20 flex items-center justify-center text-[16px] font-bold transition-colors"
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={zoomReset}
            className="w-9 h-9 rounded-md bg-white/10 text-white/60 hover:bg-white/20 flex items-center justify-center text-[10px] font-bold transition-colors"
            title="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={zoomOut}
            className="w-9 h-9 rounded-md bg-white/10 text-white/70 hover:bg-white/20 flex items-center justify-center text-[16px] font-bold transition-colors"
            title="Zoom out"
          >
            -
          </button>
        </div>

        {/* Annotation count badge */}
        {annotations.length > 0 && (
          <div className="absolute left-4 top-4">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/10 text-[11px] font-bold text-white/70 border border-white/10">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              {annotations.length} annotation{annotations.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Calibration hint (for measure tool) */}
        {showCalibration && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <div
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-[12px] text-white/80"
              style={{ background: "rgba(15,23,42,0.9)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Measurement requires calibration. Place a reference object and set its known length.</span>
              <button
                onClick={() => setShowCalibration(false)}
                className="text-white/40 hover:text-white/70 ml-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* -------------------------------------------------------- */}
      {/* Bottom tool palette                                       */}
      {/* -------------------------------------------------------- */}
      <div
        className="flex items-center gap-3 px-4 h-14 flex-shrink-0"
        style={{
          background: "rgba(15,23,42,0.85)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {/* Tool buttons */}
        <div className="flex items-center gap-1">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTool(t.id);
                setArrowStart(null);
                if (t.id !== "measure") setShowCalibration(false);
              }}
              className={`h-9 px-3 rounded-md text-[11px] font-bold flex items-center gap-1.5 transition-colors ${
                tool === t.id
                  ? "bg-ih-primary text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white/80"
              }`}
              title={t.label}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={t.icon} />
              </svg>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Separator */}
        <div className="w-px h-6 bg-white/10" />

        {/* Caption input */}
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption..."
            className="w-full h-8 px-3 rounded-md bg-white/5 border border-white/10 text-white text-[12px] placeholder-white/30 outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
      </div>
    </div>
  );
}
