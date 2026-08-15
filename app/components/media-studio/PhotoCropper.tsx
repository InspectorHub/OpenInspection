import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import { bakeCrop, normalizeRotation, type BakeFormat, type PixelCrop } from "./cropImage";
import { m } from "~/paraglide/messages";

const RATIOS: Record<string, number> = {
  "3:2": 3 / 2, "16:9": 16 / 9, "1.91:1": 1.91, "4:3": 4 / 3,
  // A square, for the round avatar crop and for the many association badges
  // that are round seals. A signature strip is far wider than any photo ratio.
  "1:1": 1, "3:1": 3,
};

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
  /**
   * Re-open on a crop that was already saved, rather than on the default frame.
   *
   * The rect is in SOURCE-pixel coordinates — the same shape `onSave` hands back
   * — and `react-easy-crop` turns it into its own pan/zoom via
   * `initialCroppedAreaPixels`. That indirection is the reason this is a rect
   * and not a `{crop, zoom}` pair: the pair only means something against a
   * known display size, so it could not survive a round trip through the
   * database or a different viewport.
   *
   * `aspect` and `orientation` come with it because the saved rect is only
   * reachable while the same preset is selected; restoring the rect under a
   * different ratio would silently re-frame it.
   */
  initialCrop?: PhotoCrop | null;
  /** Title for the dialog (accessibility). */
  title?: string;
  /** Save button label. */
  saveLabel?: string;
  /** Round mask — an avatar, or a round association seal. */
  cropShape?: "rect" | "round";
  /**
   * Output encoding. PNG for anything composited onto a document (a signature,
   * a badge): JPEG has no alpha channel, so it fills the transparency those are
   * cut out against with white, and the mark lands on the report cover as a
   * white rectangle. Photographs stay JPEG — a third of the size, nothing lost.
   */
  outputFormat?: BakeFormat;
  /** Long-edge clamp on the bake. Small for a badge, large for a photo. */
  maxLongEdge?: number;
  onCancel: () => void;
  onSave: (blob: Blob, crop: PhotoCrop) => void;
}

const DEFAULT_PRESETS = ["3:2", "16:9", "1.91:1", "4:3"];

export function PhotoCropper({
  sourceUrl,
  presets = DEFAULT_PRESETS,
  allowFree = true,
  initialAspect,
  initialCrop = null,
  title = m.media_cropper_title(),
  saveLabel = m.media_cropper_save(),
  cropShape = "rect",
  outputFormat = "image/jpeg",
  maxLongEdge,
  onCancel,
  onSave,
}: PhotoCropperProps) {
  const options = allowFree ? ["free", ...presets] : presets;
  // A saved crop wins over the caller's default: the ratio it was framed at is
  // part of the crop, not a preference to re-apply.
  const [aspectKey, setAspectKey] = useState<string>(initialCrop?.aspect ?? initialAspect ?? options[0]);
  const [portrait, setPortrait] = useState(initialCrop?.orientation === "portrait");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  /**
   * Quarter turns, because that is the shape of the problem.
   *
   * Every source that arrives sideways arrives sideways by a quarter turn — a
   * phone held the other way, a page fed into a scanner rotated. Two buttons
   * answer that exactly and read at a glance; a free-angle slider answers a
   * question nobody asked and makes the common case a matter of aim.
   */
  const [rotation, setRotation] = useState(0);
  const [pixels, setPixels] = useState<PixelCrop | null>(null);
  const [busy, setBusy] = useState(false);
  const [bakeError, setBakeError] = useState<string | null>(null);
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
    setBakeError(null);
    try {
      // Plan 4 Q5 — thread the source long edge so bakeCrop rescales the crop
      // rect when the CDN returns a bounded (<=4096) variant of a huge original.
      const blob = await bakeCrop(sourceUrl, pixels, {
        maxLongEdge, sourceLongEdge, rotation, format: outputFormat,
      });
      onSave(blob, { aspect: aspectKey, orientation: portrait ? "portrait" : "landscape", pixels });
    } catch {
      // A bake that throws used to leave the dialog sitting there exactly as it
      // was: the reader clicks Save, nothing closes, nothing saves, nothing
      // says why. Whatever the cause — an unreadable source, no canvas — the
      // one thing that must not happen is the button appearing inert.
      setBakeError(m.media_cropper_bake_failed());
    } finally { setBusy(false); }
  }

  return (
    // ds-allow: full-bleed media studio chrome, intentional fixed-dark backdrop
    <div className="fixed inset-0 z-[70] bg-[rgba(15,23,42,0.7)] flex flex-col" role="dialog" aria-modal="true" aria-label={title}>
      <div className="relative flex-1">
        <Cropper image={sourceUrl} crop={crop} zoom={zoom} aspect={ratio} rotation={rotation}
          cropShape={cropShape} showGrid={cropShape === "rect"} restrictPosition
          // Applied once, when the media has loaded and the crop box is sized —
          // after that `crop`/`zoom` are the live state and this is ignored, so
          // panning away from a restored frame is not fought.
          initialCroppedAreaPixels={initialCrop?.pixels}
          onMediaLoaded={onMediaLoaded} onRotationChange={setRotation}
          onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
      </div>
      <div className="bg-ih-bg-card border-t border-ih-border px-5 py-3 space-y-3">
        {/* Hidden when there is only ever one shape to crop to (the avatar's
            square). A row of one button that cannot be un-chosen, next to an
            orientation toggle that does nothing to a square, is a control that
            asks a question with a single answer. */}
        <div className={`items-center gap-2 flex-wrap ${options.length > 1 ? "flex" : "hidden"}`}>
          {options.map((a) => (
            <button key={a} type="button" onClick={() => setAspectKey(a)}
              className={`h-8 px-3 rounded-md text-[12px] font-bold border transition-colors ${aspectKey === a ? "border-ih-primary text-ih-primary-text" : "border-ih-border text-ih-fg-2 hover:border-ih-primary/60"}`}>
              {a === "free" ? m.media_cropper_free() : a}
            </button>
          ))}
          <button type="button" onClick={() => setPortrait((p) => !p)} title={m.media_cropper_orientation_toggle()}
            aria-pressed={portrait} disabled={isFree}
            className={`h-8 px-3 rounded-md text-[12px] font-bold border transition-colors disabled:opacity-40 ${portrait ? "border-ih-primary text-ih-primary-text" : "border-ih-border text-ih-fg-2 hover:border-ih-primary/60"}`}>
            ↔ {portrait ? m.media_cropper_portrait() : m.media_cropper_landscape()}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">{m.media_common_zoom()}</span>
          <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-ih-primary" aria-label={m.media_common_zoom()} />
          {/* Quarter turns, beside the zoom they belong with: both are "get the
              subject where I want it before I cut". */}
          <button type="button" onClick={() => setRotation((r) => normalizeRotation(r - 90))}
            aria-label={m.media_cropper_rotate_left()} title={m.media_cropper_rotate_left()}
            className="h-8 w-8 shrink-0 rounded-md border border-ih-border text-ih-fg-2 hover:border-ih-primary hover:text-ih-primary-text transition-colors flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a4 4 0 014 4v2M3 10l4-4M3 10l4 4" /></svg>
          </button>
          <button type="button" onClick={() => setRotation((r) => normalizeRotation(r + 90))}
            aria-label={m.media_cropper_rotate_right()} title={m.media_cropper_rotate_right()}
            className="h-8 w-8 shrink-0 rounded-md border border-ih-border text-ih-fg-2 hover:border-ih-primary hover:text-ih-primary-text transition-colors flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a4 4 0 00-4 4v2M21 10l-4-4M21 10l-4 4" /></svg>
          </button>
        </div>
        <div className="flex items-center justify-end gap-3">
          {bakeError && (
            <p role="alert" className="mr-auto text-[12px] text-ih-bad-fg font-medium">{bakeError}</p>
          )}
          <button type="button" onClick={onCancel} className="h-9 px-4 rounded-md border border-ih-border text-ih-fg-2 text-[13px] font-bold hover:bg-ih-bg-muted">{m.common_cancel()}</button>
          <button type="button" onClick={handleSave} disabled={busy || !pixels} className="h-9 px-4 rounded-md bg-ih-primary text-ih-fg-inverse text-[13px] font-bold hover:bg-ih-primary-600 disabled:opacity-50">
            {busy ? m.common_saving() : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
