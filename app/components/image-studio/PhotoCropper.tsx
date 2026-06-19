import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import { bakeCrop, type PixelCrop } from "./cropImage";

const RATIOS: Record<string, number> = { "3:2": 3 / 2, "16:9": 16 / 9, "1.91:1": 1.91, "4:3": 4 / 3 };

export interface PhotoCrop {
  aspect: string; // 'free' or a preset key
  orientation: "landscape" | "portrait";
  pixels: PixelCrop;
}

export interface PhotoCropperProps {
  sourceUrl: string;
  /** Aspect preset keys to offer (cover passes its fixed list). */
  presets?: string[];
  /** Offer a free-aspect (unconstrained) option. Default true for item/defect photos. */
  allowFree?: boolean;
  /** Initial selected aspect ('free' or a preset key). */
  initialAspect?: string;
  /** Title for the dialog (accessibility). */
  title?: string;
  /** Save button label. */
  saveLabel?: string;
  onCancel: () => void;
  onSave: (blob: Blob, crop: PhotoCrop) => void;
}

const DEFAULT_PRESETS = ["3:2", "16:9", "1.91:1", "4:3"];

export function PhotoCropper({
  sourceUrl,
  presets = DEFAULT_PRESETS,
  allowFree = true,
  initialAspect,
  title = "Crop photo",
  saveLabel = "Save crop",
  onCancel,
  onSave,
}: PhotoCropperProps) {
  const options = allowFree ? ["free", ...presets] : presets;
  const [aspectKey, setAspectKey] = useState<string>(initialAspect ?? options[0]);
  const [portrait, setPortrait] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<PixelCrop | null>(null);
  const [busy, setBusy] = useState(false);
  // Plan 4 Q5 — the source image's long edge (natural px). Threaded into bakeCrop
  // so the crop rect is rescaled when the CDN returns a bounded variant.
  const [sourceLongEdge, setSourceLongEdge] = useState<number | undefined>(undefined);

  const isFree = aspectKey === "free";
  const baseRatio = isFree ? undefined : RATIOS[aspectKey];
  const ratio = baseRatio == null ? undefined : (portrait ? 1 / baseRatio : baseRatio);
  const onCropComplete = useCallback((_a: unknown, areaPixels: PixelCrop) => setPixels(areaPixels), []);
  const onMediaLoaded = useCallback((mediaSize: { naturalWidth: number; naturalHeight: number }) => {
    setSourceLongEdge(Math.max(mediaSize.naturalWidth, mediaSize.naturalHeight));
  }, []);

  async function handleSave() {
    if (!pixels) return;
    setBusy(true);
    try {
      // Plan 4 Q5 — thread the source long edge so bakeCrop rescales the crop
      // rect when the CDN returns a bounded (<=4096) variant of a huge original.
      const blob = await bakeCrop(sourceUrl, pixels, undefined, sourceLongEdge);
      onSave(blob, { aspect: aspectKey, orientation: portrait ? "portrait" : "landscape", pixels });
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-[rgba(15,23,42,0.7)] flex flex-col" role="dialog" aria-modal="true" aria-label={title}>
      <div className="relative flex-1">
        <Cropper image={sourceUrl} crop={crop} zoom={zoom} aspect={ratio} showGrid restrictPosition
          onMediaLoaded={onMediaLoaded}
          onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
      </div>
      <div className="bg-ih-bg-card border-t border-ih-border px-5 py-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {options.map((a) => (
            <button key={a} type="button" onClick={() => setAspectKey(a)}
              className={`h-8 px-3 rounded-md text-[12px] font-bold border transition-colors ${aspectKey === a ? "border-ih-primary text-ih-primary" : "border-ih-border text-ih-fg-2 hover:border-ih-primary/60"}`}>
              {a === "free" ? "Free" : a}
            </button>
          ))}
          <button type="button" onClick={() => setPortrait((p) => !p)} title="Switch portrait/landscape"
            aria-pressed={portrait} disabled={isFree}
            className={`h-8 px-3 rounded-md text-[12px] font-bold border transition-colors disabled:opacity-40 ${portrait ? "border-ih-primary text-ih-primary" : "border-ih-border text-ih-fg-2 hover:border-ih-primary/60"}`}>
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
            {busy ? "Saving…" : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
