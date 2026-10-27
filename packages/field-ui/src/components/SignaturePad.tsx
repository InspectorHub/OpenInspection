import { useRef, useState, useEffect } from "react";
import { PENDING_CLASS, pendingProps } from "@core/shared-ui";
import { m } from "../i18n";

interface Props {
  onSubmit: (dataUri: string) => Promise<void> | void;
  onCancel?: () => void;
  label?: string;
}

const PAPER = { backgroundColor: "#ffffff", borderColor: "#cbd5e1" } as const;

export function SignaturePad({ onSubmit, onCancel, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f172a";
  }, []);

  const pos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const point = "touches" in e ? e.touches[0] : (e as React.MouseEvent);
    // The canvas may be drawn smaller than its 400x150 bitmap (a phone card): map the finger to bitmap pixels.
    const sx = rect.width > 0 ? canvas.width / rect.width : 1;
    const sy = rect.height > 0 ? canvas.height / rect.height : 1;
    return { x: (point.clientX - rect.left) * sx, y: (point.clientY - rect.top) * sy };
  };

  const start = (e: React.MouseEvent | React.TouchEvent) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
  };

  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasInk(true);
  };

  const end = () => setDrawing(false);

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const submit = async () => {
    if (inFlight.current) return;
    if (!hasInk) {
      setError(m.common_signature_pad_empty());
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const data = canvasRef.current!.toDataURL("image/png");
      await onSubmit(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="border border-ih-border rounded-lg p-4 bg-ih-bg-card">
      <canvas
        ref={canvasRef}
        width={400}
        height={150}
        // Paper stays white in every theme: the ink is dark, and the exported PNG carries the ink alone.
        style={PAPER}
        className="block w-full max-w-[400px] border rounded cursor-crosshair touch-none"
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      {error && <p className="text-sm text-ih-bad-fg mt-2">{error}</p>}
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          className={`text-sm text-ih-fg-3 underline ${PENDING_CLASS}`}
          {...pendingProps(busy, clear)}
        >
          {m.common_clear()}
        </button>
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <button type="button" className={`text-sm ${PENDING_CLASS}`} {...pendingProps(busy, onCancel)}>
              {m.common_cancel()}
            </button>
          )}
          <button
            type="button"
            className={`text-sm font-semibold bg-ih-primary text-ih-fg-inverse px-3 py-1 rounded ${PENDING_CLASS}`}
            {...pendingProps(busy, submit)}
          >
            {busy ? "..." : (label ?? m.common_signature_pad_sign())}
          </button>
        </div>
      </div>
    </div>
  );
}
