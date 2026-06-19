import { useState, useEffect, useCallback, useRef } from "react";
import { Stage, Layer, Image as KonvaImage, Circle, Arrow, Line, Label, Tag, Text } from "react-konva";
import type Konva from "konva";
import {
  ANNOTATION_COLOR,
  deserializeMeasureDoc,
  serializeMeasureDoc,
  type Annotation,
  type Point,
} from "./annotations";

/* ------------------------------------------------------------------ */
/* Tool palette (ported from editor/PhotoStudio.tsx)                   */
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

const STROKE = 4; // logical px (natural-resolution); divided by scale when rendered
const CIRCLE_R = 40; // default circle radius in natural px

interface PhotoAnnotatorProps {
  open: boolean;
  photoUrl: string | null;
  photoIndex?: number;
  totalPhotos?: number;
  sectionName?: string;
  initialAnnotationsJson?: string | null;
  /** whether the open photo is the current report cover. */
  isCover?: boolean;
  /** set the open photo as the report cover (omit to hide the control). */
  onSetCover?: () => void;
  onSave: (data: { blob: Blob; nodesJson: string; caption: string }) => void;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function PhotoAnnotator({
  open,
  photoUrl,
  photoIndex,
  totalPhotos,
  sectionName,
  initialAnnotationsJson,
  isCover,
  onSetCover,
  onSave,
  onClose,
}: PhotoAnnotatorProps) {
  /* Client-only mount — konva touches the DOM (RR7 SSR safety) */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [tool, setTool] = useState<ToolId>("circle");
  const [zoom, setZoom] = useState(1);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [caption, setCaption] = useState(sectionName || "");

  // The loaded source image at natural resolution + the fit scale (natural -> display).
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number }>({ w: 600, h: 400 });
  const [fitScale, setFitScale] = useState(1);

  // Two-click arrow / measure state (in natural px).
  const [arrowStart, setArrowStart] = useState<Point | null>(null);
  const [measureStart, setMeasureStart] = useState<Point | null>(null);

  // Freehand drawing (natural px).
  const [freehandPoints, setFreehandPoints] = useState<Point[]>([]);
  const [isDrawingFreehand, setIsDrawingFreehand] = useState(false);

  // Inline HTML label input — positioned in display px over the stage.
  const [labelInput, setLabelInput] = useState<Point | null>(null);
  const [labelText, setLabelText] = useState("");
  const labelInputRef = useRef<HTMLInputElement>(null);

  // Measure calibration. `pxPerUnit` null => uncalibrated (show raw px distance).
  const [showCalibration, setShowCalibration] = useState(false);
  const [pxPerUnit, setPxPerUnit] = useState<number | null>(null);
  const [calibLine, setCalibLine] = useState<{ a: Point; b: Point } | null>(null);
  const [calibKnown, setCalibKnown] = useState("");
  const [calibUnit, setCalibUnit] = useState("in");
  // Committed measurements (kept in component state, not serialized — not part of Annotation).
  const [measures, setMeasures] = useState<Array<{ a: Point; b: Point }>>([]);

  const stageRef = useRef<Konva.Stage>(null);

  /* The display scale combines fit-to-viewport and the zoom multiplier. */
  const scale = fitScale * zoom;

  /* -------------------------------------------------------------- */
  /* Reset on open + seed annotations                                */
  /* -------------------------------------------------------------- */
  useEffect(() => {
    if (!open) return;
    // P6 — seed annotations AND restore measure shapes + calibration so a
    // measurement survives reopen. `measure` annotations rebuild the visual
    // measure lines; the calibration restores px-per-unit.
    const doc = deserializeMeasureDoc(initialAnnotationsJson);
    setAnnotations(doc.annotations.filter((a) => a.kind !== "measure"));
    setMeasures(
      doc.annotations
        .filter((a): a is Extract<Annotation, { kind: "measure" }> => a.kind === "measure")
        .map((m) => ({ a: { x: m.x, y: m.y }, b: { x: m.x2, y: m.y2 } })),
    );
    setCaption(sectionName || "");
    setZoom(1);
    setTool("circle");
    setArrowStart(null);
    setMeasureStart(null);
    setFreehandPoints([]);
    setIsDrawingFreehand(false);
    setLabelInput(null);
    setLabelText("");
    setShowCalibration(false);
    setPxPerUnit(doc.calibration?.pxPerUnit ?? null);
    setCalibLine(null);
    setCalibKnown("");
    setCalibUnit(doc.calibration?.calibUnit ?? "in");
  }, [open, sectionName, initialAnnotationsJson]);

  /* -------------------------------------------------------------- */
  /* Load the source image at natural resolution + compute fit       */
  /* -------------------------------------------------------------- */
  useEffect(() => {
    if (!open || !mounted) return;
    if (!photoUrl) {
      setImage(null);
      setNatural({ w: 600, h: 400 });
      setFitScale(1);
      return;
    }
    const img = new window.Image();
    img.crossOrigin = "anonymous"; // allow toBlob export of cross-origin photos
    img.onload = () => {
      const w = img.naturalWidth || 600;
      const h = img.naturalHeight || 400;
      const maxW = window.innerWidth * 0.9;
      const maxH = window.innerHeight * 0.7;
      const fit = Math.min(maxW / w, maxH / h, 1);
      setImage(img);
      setNatural({ w, h });
      setFitScale(fit);
    };
    img.src = photoUrl;
  }, [open, mounted, photoUrl]);

  /* -------------------------------------------------------------- */
  /* Focus label input when it appears                               */
  /* -------------------------------------------------------------- */
  useEffect(() => {
    if (labelInput) {
      const t = setTimeout(() => labelInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [labelInput]);

  /* -------------------------------------------------------------- */
  /* Escape to close (label input swallows it first)                 */
  /* -------------------------------------------------------------- */
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (labelInput) {
        setLabelInput(null);
        setLabelText("");
        return;
      }
      e.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose, labelInput]);

  /* -------------------------------------------------------------- */
  /* Pointer -> natural px                                           */
  /* -------------------------------------------------------------- */
  const naturalPointer = useCallback((): Point | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const p = stage.getPointerPosition();
    if (!p) return null;
    return { x: p.x / scale, y: p.y / scale };
  }, [scale]);

  /* -------------------------------------------------------------- */
  /* Stage click (circle / arrow / label / measure)                 */
  /* -------------------------------------------------------------- */
  const handleStageClick = useCallback(() => {
    if (labelInput) return;
    const pos = naturalPointer();
    if (!pos) return;

    if (tool === "circle") {
      setAnnotations((prev) => [...prev, { kind: "circle", x: pos.x, y: pos.y, r: CIRCLE_R }]);
    } else if (tool === "text") {
      setLabelInput(pos);
      setLabelText("");
    } else if (tool === "arrow") {
      if (!arrowStart) {
        setArrowStart(pos);
      } else {
        setAnnotations((prev) => [
          ...prev,
          { kind: "arrow", x: arrowStart.x, y: arrowStart.y, x2: pos.x, y2: pos.y },
        ]);
        setArrowStart(null);
      }
    } else if (tool === "measure") {
      if (!measureStart) {
        setMeasureStart(pos);
      } else {
        const line = { a: measureStart, b: pos };
        setMeasureStart(null);
        if (pxPerUnit == null) {
          // First measurement defines the calibration reference.
          setCalibLine(line);
          setShowCalibration(true);
        } else {
          setMeasures((prev) => [...prev, line]);
        }
      }
    }
  }, [tool, arrowStart, measureStart, pxPerUnit, naturalPointer, labelInput]);

  /* -------------------------------------------------------------- */
  /* Freehand: mousedown / move / up                                */
  /* -------------------------------------------------------------- */
  const handleMouseDown = useCallback(() => {
    if (tool !== "free" || labelInput) return;
    const pos = naturalPointer();
    if (!pos) return;
    setFreehandPoints([pos]);
    setIsDrawingFreehand(true);
  }, [tool, labelInput, naturalPointer]);

  const handleMouseMove = useCallback(() => {
    if (!isDrawingFreehand || tool !== "free") return;
    const pos = naturalPointer();
    if (!pos) return;
    setFreehandPoints((prev) => [...prev, pos]);
  }, [isDrawingFreehand, tool, naturalPointer]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawingFreehand || tool !== "free") return;
    if (freehandPoints.length > 1) {
      setAnnotations((prev) => [
        ...prev,
        { kind: "freehand", x: freehandPoints[0].x, y: freehandPoints[0].y, points: freehandPoints },
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
  /* Calibration commit                                              */
  /* -------------------------------------------------------------- */
  const commitCalibration = useCallback(() => {
    const known = parseFloat(calibKnown);
    if (calibLine && known > 0) {
      const dx = calibLine.b.x - calibLine.a.x;
      const dy = calibLine.b.y - calibLine.a.y;
      const px = Math.sqrt(dx * dx + dy * dy);
      if (px > 0) {
        setPxPerUnit(px / known);
        setMeasures((prev) => [...prev, calibLine]);
      }
    }
    setShowCalibration(false);
    setCalibLine(null);
    setCalibKnown("");
  }, [calibLine, calibKnown]);

  /* -------------------------------------------------------------- */
  /* Undo / zoom                                                     */
  /* -------------------------------------------------------------- */
  const undoLast = useCallback(() => setAnnotations((prev) => prev.slice(0, -1)), []);
  const zoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.25, 4)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.25, 0.5)), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  /* -------------------------------------------------------------- */
  /* Save — export stage to PNG at NATURAL resolution                */
  /* -------------------------------------------------------------- */
  const handleSave = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;
    // pixelRatio 1/scale maps the scaled-down display stage back to natural px.
    // konva@10 toBlob returns a Promise (callback optional).
    let blob: Blob | null = null;
    try {
      blob = (await stage.toBlob({ pixelRatio: 1 / scale, mimeType: "image/png" })) as Blob | null;
    } catch {
      // Fallback for environments where toBlob is unavailable on the Stage.
      const canvas = stage.toCanvas({ pixelRatio: 1 / scale });
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );
    }
    if (!blob) return;
    // P6 — derive `measure` annotations from the committed measure lines and
    // serialize them together with the calibration so measurements persist.
    const measureAnns: Annotation[] = measures.map((m) => ({
      kind: "measure", x: m.a.x, y: m.a.y, x2: m.b.x, y2: m.b.y, unit: calibUnit,
    }));
    const calibration = pxPerUnit != null ? { pxPerUnit, calibUnit } : null;
    onSave({ blob, nodesJson: serializeMeasureDoc([...annotations, ...measureAnns], calibration), caption });
  }, [annotations, measures, calibUnit, pxPerUnit, caption, scale, onSave]);

  /* -------------------------------------------------------------- */
  /* Render                                                          */
  /* -------------------------------------------------------------- */
  if (!open || !mounted) return null;

  const stageW = natural.w * scale;
  const stageH = natural.h * scale;
  const sw = STROKE / scale; // stroke width in natural px so it looks constant on screen

  const fmtDistance = (a: Point, b: Point) => {
    const px = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    if (pxPerUnit && pxPerUnit > 0) {
      return `${(px / pxPerUnit).toFixed(1)} ${calibUnit}`;
    }
    return `${Math.round(px)} px`;
  };

  return (
    /* ds-allow: fixed-dark photo-studio chrome (white/* neutrals + amber-400 hints stay dark in both themes) */
    <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: "rgba(0,0,0,0.92)" }}>
      {/* -------------------------------------------------------- */}
      {/* Top bar                                                   */}
      {/* -------------------------------------------------------- */}
      <div
        className="flex items-center gap-3 px-4 h-14 flex-shrink-0"
        style={{ background: "rgba(15,23,42,0.8)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-md flex items-center justify-center text-white/70 hover:bg-white/10 transition-colors"
          aria-label="Close photo studio"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="flex-1 min-w-0 text-center">
          <span className="text-[14px] font-bold text-white/90">
            {photoIndex != null && totalPhotos != null && totalPhotos > 0
              ? `Photo ${photoIndex} of ${totalPhotos}`
              : "Photo Studio"}
          </span>
          {arrowStart && (
            <span className="block text-[11px] text-amber-400 font-medium">Click to set arrow endpoint</span>
          )}
          {measureStart && (
            <span className="block text-[11px] text-amber-400 font-medium">Click to set measurement endpoint</span>
          )}
          {tool === "free" && !isDrawingFreehand && (
            <span className="block text-[11px] text-white/50">Click and drag to draw</span>
          )}
        </div>

        {/* set the open photo as the report cover */}
        {onSetCover && photoUrl && (
          <button
            type="button"
            onClick={onSetCover}
            className={`h-8 px-3 rounded-md text-[12px] font-bold border transition-colors flex items-center gap-1.5 ${
              isCover
                ? "text-amber-300 bg-amber-400/15 border-amber-400/40"
                : "text-white/60 bg-white/5 border-white/10 hover:bg-white/10"
            }`}
            title={isCover ? "This is the report cover" : "Set as report cover"}
          >
            <svg className="w-3.5 h-3.5" fill={isCover ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.48 3.5a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
            {isCover ? "Cover" : "Set as cover"}
          </button>
        )}

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

        <button
          onClick={handleSave}
          className="h-8 px-4 rounded-md bg-ih-primary text-white text-[12px] font-bold hover:bg-ih-primary-600 transition-colors flex items-center gap-1.5"
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
      <div className="flex-1 relative overflow-auto">
        <div className="absolute inset-0 flex items-center justify-center">
          {photoUrl && image ? (
            <div className="relative" style={{ width: stageW, height: stageH }}>
              <Stage
                ref={stageRef}
                width={stageW}
                height={stageH}
                onClick={handleStageClick}
                onTap={handleStageClick}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                style={{ cursor: tool === "pan" ? "move" : "crosshair" }}
              >
                {/* Background image layer */}
                <Layer listening={false}>
                  <KonvaImage image={image} width={natural.w} height={natural.h} scaleX={scale} scaleY={scale} />
                </Layer>

                {/* Annotation layer (drawn in natural px, scaled by the stage's group) */}
                <Layer scaleX={scale} scaleY={scale} listening={false}>
                  {annotations.map((ann, i) => {
                    if (ann.kind === "circle") {
                      return (
                        <Circle
                          key={i}
                          x={ann.x}
                          y={ann.y}
                          radius={ann.r}
                          stroke={ANNOTATION_COLOR}
                          strokeWidth={sw}
                        />
                      );
                    }
                    if (ann.kind === "arrow") {
                      return (
                        <Arrow
                          key={i}
                          points={[ann.x, ann.y, ann.x2, ann.y2]}
                          stroke={ANNOTATION_COLOR}
                          fill={ANNOTATION_COLOR}
                          strokeWidth={sw}
                          pointerLength={12 / scale}
                          pointerWidth={12 / scale}
                        />
                      );
                    }
                    if (ann.kind === "freehand" && ann.points.length > 1) {
                      return (
                        <Line
                          key={i}
                          points={ann.points.flatMap((p) => [p.x, p.y])}
                          stroke={ANNOTATION_COLOR}
                          strokeWidth={sw}
                          lineCap="round"
                          lineJoin="round"
                          tension={0.4}
                        />
                      );
                    }
                    if (ann.kind === "label") {
                      return (
                        <Label key={i} x={ann.x} y={ann.y}>
                          <Tag fill="#000000" opacity={0.85} cornerRadius={3 / scale} />
                          <Text
                            text={ann.text}
                            fill={ANNOTATION_COLOR}
                            fontStyle="bold"
                            fontSize={16 / scale}
                            padding={4 / scale}
                          />
                        </Label>
                      );
                    }
                    return null;
                  })}

                  {/* Active arrow start marker */}
                  {arrowStart && <Circle x={arrowStart.x} y={arrowStart.y} radius={5 / scale} fill={ANNOTATION_COLOR} />}

                  {/* Active measure start marker */}
                  {measureStart && <Circle x={measureStart.x} y={measureStart.y} radius={5 / scale} fill="#fbbf24" />}

                  {/* Active freehand preview */}
                  {isDrawingFreehand && freehandPoints.length > 1 && (
                    <Line
                      points={freehandPoints.flatMap((p) => [p.x, p.y])}
                      stroke={ANNOTATION_COLOR}
                      strokeWidth={sw}
                      lineCap="round"
                      lineJoin="round"
                      opacity={0.6}
                    />
                  )}

                  {/* Committed measurements: line + distance text */}
                  {measures.map((m, i) => (
                    <Arrow
                      key={`m-${i}`}
                      points={[m.a.x, m.a.y, m.b.x, m.b.y]}
                      stroke="#fbbf24"
                      fill="#fbbf24"
                      strokeWidth={sw}
                      pointerAtBeginning
                      pointerLength={10 / scale}
                      pointerWidth={10 / scale}
                    />
                  ))}
                  {measures.map((m, i) => (
                    <Label key={`mt-${i}`} x={(m.a.x + m.b.x) / 2} y={(m.a.y + m.b.y) / 2}>
                      <Tag fill="#000000" opacity={0.85} cornerRadius={3 / scale} />
                      <Text
                        text={fmtDistance(m.a, m.b)}
                        fill="#fbbf24"
                        fontStyle="bold"
                        fontSize={14 / scale}
                        padding={4 / scale}
                      />
                    </Label>
                  ))}
                </Layer>
              </Stage>

              {/* Inline HTML label input — positioned in display px over the stage */}
              {labelInput && (
                <div
                  className="absolute z-10"
                  style={{
                    left: labelInput.x * scale,
                    top: labelInput.y * scale,
                    transform: "translate(-50%, -120%)",
                  }}
                >
                  <div className="bg-slate-800 rounded-lg border border-white/20 p-2 shadow-ih-popover">
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
                      className="w-40 h-7 px-2 rounded bg-slate-700 text-white text-[12px] border border-white/10 outline-none focus:border-ih-primary placeholder-white/30"
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
                        className="px-2 py-0.5 rounded text-[10px] font-bold text-white bg-ih-primary hover:bg-ih-primary-600"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
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

        {/* Calibration overlay (measure tool) */}
        {showCalibration && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <div
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-[12px] text-white/80"
              style={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Reference length:</span>
              <input
                type="number"
                min="0"
                step="any"
                value={calibKnown}
                onChange={(e) => setCalibKnown(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitCalibration();
                  }
                  e.stopPropagation();
                }}
                placeholder="e.g. 12"
                className="w-20 h-7 px-2 rounded bg-slate-700 text-white text-[12px] border border-white/10 outline-none focus:border-ih-primary placeholder-white/30"
              />
              <select
                value={calibUnit}
                onChange={(e) => setCalibUnit(e.target.value)}
                className="h-7 px-1.5 rounded bg-slate-700 text-white text-[12px] border border-white/10 outline-none focus:border-ih-primary"
              >
                <option value="in">in</option>
                <option value="ft">ft</option>
                <option value="cm">cm</option>
                <option value="m">m</option>
                <option value="mm">mm</option>
              </select>
              <button
                onClick={commitCalibration}
                className="h-7 px-3 rounded bg-ih-primary text-white text-[11px] font-bold hover:bg-ih-primary-600"
              >
                Set
              </button>
              <button
                onClick={() => {
                  setShowCalibration(false);
                  setCalibLine(null);
                  setCalibKnown("");
                }}
                className="text-white/40 hover:text-white/70 ml-1"
                aria-label="Cancel calibration"
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
        style={{ background: "rgba(15,23,42,0.85)", borderTop: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-center gap-1">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTool(t.id);
                setArrowStart(null);
                setMeasureStart(null);
                if (t.id !== "measure") {
                  setShowCalibration(false);
                  setCalibLine(null);
                }
              }}
              className={`h-9 px-3 rounded-md text-[11px] font-bold flex items-center gap-1.5 transition-colors ${
                tool === t.id ? "bg-ih-primary text-white" : "text-white/60 hover:bg-white/10 hover:text-white/80"
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

        <div className="w-px h-6 bg-white/10" />

        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption..."
            className="w-full h-8 px-3 rounded-md bg-white/5 border border-white/10 text-white text-[12px] placeholder-white/30 outline-none focus:border-ih-primary transition-colors"
          />
        </div>
      </div>
    </div>
  );
}
