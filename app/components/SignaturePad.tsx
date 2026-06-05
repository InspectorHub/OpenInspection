import { useRef, useState, useEffect } from "react";

interface Props {
  onSubmit: (dataUri: string) => Promise<void> | void;
  onCancel?: () => void;
  label?: string;
}

export function SignaturePad({ onSubmit, onCancel, label = "Sign" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
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
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
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
    if (!hasInk) {
      setError("Draw your signature first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = canvasRef.current!.toDataURL("image/png");
      await onSubmit(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-ih-border rounded-lg p-4 bg-ih-bg-1">
      <canvas
        ref={canvasRef}
        width={400}
        height={150}
        className="border border-ih-border bg-ih-bg-card rounded cursor-crosshair touch-none"
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
          className="text-sm text-ih-fg-3 underline"
          onClick={clear}
          disabled={busy}
        >
          Clear
        </button>
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <button type="button" className="text-sm" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="text-sm font-semibold bg-ih-primary text-white px-3 py-1 rounded"
            onClick={submit}
            disabled={busy}
          >
            {busy ? "..." : label}
          </button>
        </div>
      </div>
    </div>
  );
}
