import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import { bakeCrop, type PixelCrop } from "./cropImage";

type Aspect = "3:2" | "16:9" | "1.91:1" | "4:3";
const RATIOS: Record<Aspect, number> = { "3:2": 3 / 2, "16:9": 16 / 9, "1.91:1": 1.91, "4:3": 4 / 3 };
const PRESETS: Aspect[] = ["3:2", "16:9", "1.91:1", "4:3"];

export interface CoverCropperProps {
  sourceUrl: string;
  sourceKey: string;
  onCancel: () => void;
  onSave: (blob: Blob, crop: { aspect: Aspect; orientation: "landscape" | "portrait"; pixels: PixelCrop }) => void;
}

export function CoverCropper({ sourceUrl, sourceKey, onCancel, onSave }: CoverCropperProps) {
  void sourceKey;
  const [aspect, setAspect] = useState<Aspect>("3:2");
  const [portrait, setPortrait] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<PixelCrop | null>(null);
  const [busy, setBusy] = useState(false);
  const ratio = portrait ? 1 / RATIOS[aspect] : RATIOS[aspect];
  const onCropComplete = useCallback((_a: unknown, areaPixels: PixelCrop) => setPixels(areaPixels), []);

  async function handleSave() {
    if (!pixels) return;
    setBusy(true);
    try {
      const blob = await bakeCrop(sourceUrl, pixels);
      onSave(blob, { aspect, orientation: portrait ? "portrait" : "landscape", pixels });
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-[rgba(15,23,42,0.7)] flex flex-col" role="dialog" aria-modal="true" aria-label="Crop cover photo">
      <div className="relative flex-1">
        <Cropper image={sourceUrl} crop={crop} zoom={zoom} aspect={ratio} showGrid restrictPosition
          onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
      </div>
      <div className="bg-ih-bg-card border-t border-ih-border px-5 py-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {PRESETS.map((a) => (
            <button key={a} type="button" onClick={() => setAspect(a)}
              className={`h-8 px-3 rounded-md text-[12px] font-bold border transition-colors ${aspect === a ? "border-ih-primary text-ih-primary" : "border-ih-border text-ih-fg-2 hover:border-ih-primary/60"}`}>
              {a === "3:2" ? "3:2 · Cover" : a}
            </button>
          ))}
          <button type="button" onClick={() => setPortrait((p) => !p)} title="Switch portrait/landscape" aria-pressed={portrait}
            className={`h-8 px-3 rounded-md text-[12px] font-bold border transition-colors ${portrait ? "border-ih-primary text-ih-primary" : "border-ih-border text-ih-fg-2 hover:border-ih-primary/60"}`}>
            ↔ {portrait ? "Portrait" : "Landscape"}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">Zoom</span>
          <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-ih-primary" aria-label="Zoom" />
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onCancel} className="h-9 px-4 rounded-md border border-ih-border text-ih-fg-2 text-[13px] font-bold hover:bg-ih-bg-muted">Cancel</button>
          <button type="button" onClick={handleSave} disabled={busy || !pixels} className="h-9 px-4 rounded-md bg-ih-primary text-white text-[13px] font-bold hover:bg-ih-primary-600 disabled:opacity-50">
            {busy ? "Saving…" : "Save cover"}
          </button>
        </div>
      </div>
    </div>
  );
}
