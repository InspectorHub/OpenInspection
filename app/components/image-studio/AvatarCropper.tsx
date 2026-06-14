import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import { bakeCrop, type PixelCrop } from "./cropImage";

const AVATAR_EDGE = 512;
export interface AvatarCropperProps {
  sourceUrl: string;
  onCancel: () => void;
  onSave: (blob: Blob) => void;
}
export function AvatarCropper({ sourceUrl, onCancel, onSave }: AvatarCropperProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<PixelCrop | null>(null);
  const [busy, setBusy] = useState(false);
  const onComplete = useCallback((_a: unknown, p: PixelCrop) => setPixels(p), []);
  async function handleSave() {
    if (!pixels) return;
    setBusy(true);
    try { onSave(await bakeCrop(sourceUrl, pixels, AVATAR_EDGE)); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-[80] bg-[rgba(15,23,42,0.7)] flex flex-col" role="dialog" aria-modal="true" aria-label="Crop avatar">
      <div className="relative flex-1">
        <Cropper image={sourceUrl} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false} restrictPosition
          onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onComplete} />
      </div>
      <div className="bg-ih-bg-card border-t border-ih-border px-5 py-3 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">Zoom</span>
          <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-ih-primary" aria-label="Zoom" />
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onCancel} className="h-9 px-4 rounded-md border border-ih-border text-ih-fg-2 text-[13px] font-bold hover:bg-ih-bg-muted">Cancel</button>
          <button type="button" onClick={handleSave} disabled={busy || !pixels} className="h-9 px-4 rounded-md bg-ih-primary text-white text-[13px] font-bold hover:bg-ih-primary-600 disabled:opacity-50">{busy ? "Saving…" : "Save photo"}</button>
        </div>
      </div>
    </div>
  );
}
