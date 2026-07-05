import { useState, useRef, useCallback, useEffect } from "react";
import { Icon } from "@core/shared-ui";

interface Capture {
  id: string;
  url: string;
}

interface BurstCameraProps {
  open: boolean;
  onClose: () => void;
  onCommit: (blobs: Blob[]) => void;
}

export function BurstCamera({ open, onClose, onCommit }: BurstCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const burstTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [burstActive, setBurstActive] = useState(false);
  const [burstCount, setBurstCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("environment");

  const startCamera = useCallback(async (facingMode: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      onClose();
    }
  }, [onClose]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (open) {
      startCamera(facing);
    } else {
      stopCamera();
      setCaptures([]);
      setBurstActive(false);
      setBurstCount(0);
    }
    return () => stopCamera();
  }, [open, facing, startCamera, stopCamera]);

  if (!open) return null;

  function captureFrame(): Capture | null {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    const url = canvas.toDataURL("image/jpeg", 0.85);
    return { id: crypto.randomUUID(), url };
  }

  function onShutterDown() {
    const frame = captureFrame();
    if (frame) setCaptures((prev) => [...prev, frame]);

    // Start burst after 200ms hold
    burstTimerRef.current = setInterval(() => {
      setBurstActive(true);
      setBurstCount((c) => {
        if (c >= 30) {
          if (burstTimerRef.current) clearInterval(burstTimerRef.current);
          return c;
        }
        const f = captureFrame();
        if (f) setCaptures((prev) => [...prev, f]);
        return c + 1;
      });
    }, 100);
  }

  function onShutterUp() {
    if (burstTimerRef.current) clearInterval(burstTimerRef.current);
    burstTimerRef.current = null;
    setBurstActive(false);
    setBurstCount(0);
  }

  function discardOne(id: string) {
    setCaptures((prev) => prev.filter((c) => c.id !== id));
  }

  function discardAll() {
    setCaptures([]);
  }

  async function commit() {
    setUploading(true);
    try {
      const blobs = await Promise.all(
        captures.map(async (c) => {
          const res = await fetch(c.url);
          return res.blob();
        })
      );
      onCommit(blobs);
      onClose();
    } finally {
      setUploading(false);
    }
  }

  function switchFacing() {
    stopCamera();
    setFacing((f) => (f === "user" ? "environment" : "user"));
  }

  return (
    /* ds-allow: fixed-dark full-screen camera overlay (stays dark in both themes) */
    <div className="fixed inset-0 z-50 bg-black flex flex-col" role="dialog" aria-label="Burst camera" aria-modal="true">
      <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" />
      <canvas ref={canvasRef} className="hidden" />

      {/* Top chrome */}
      {/* ds-allow: fixed-dark camera overlay chrome (light-on-dark) */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-4">
        <button type="button" onClick={onClose} className="w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60" aria-label="Close camera">
          <Icon name="x" className="w-5 h-5" />
        </button>
        {captures.length > 0 && (
          <div className="text-white text-xs font-mono px-3 py-1 rounded-full bg-black/40">{captures.length} captured</div>
        )}
        <button type="button" onClick={switchFacing} className="w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60" aria-label="Switch camera">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114-3M20 15a8 8 0 01-14 3" /></svg>
        </button>
      </div>

      <div className="flex-1" />

      {/* Thumbnail strip */}
      {captures.length > 0 && (
        <div className="relative z-10 mb-3 px-4">
          {/* ds-allow: fixed-dark camera overlay thumbnails (light-on-dark border) */}
          <div className="flex gap-2 overflow-x-auto pb-1" data-testid="burst-thumbnails">
            {captures.map((c) => (
              <div key={c.id} className="relative flex-shrink-0">
                <img src={c.url} className="w-16 h-16 object-cover rounded-md border-2 border-white/30" alt="Captured frame" />
                <button type="button" onClick={() => discardOne(c.id)} className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-ih-bad text-white text-xs font-bold flex items-center justify-center hover:bg-ih-bad/85" aria-label="Discard this frame">x</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom action row */}
      <div className="relative z-10 pb-8 px-4 flex items-center justify-between gap-4">
        {/* ds-allow: fixed-dark camera overlay control (light-on-dark) */}
        {captures.length > 0 ? (
          <button type="button" onClick={discardAll} className="text-rose-300 text-xs font-semibold hover:text-rose-200">Discard all</button>
        ) : <div className="w-20" />}

        {/* ds-allow: fixed-dark camera shutter (white button + rose burst ring + dark label, stays fixed in both themes) */}
        <button
          type="button"
          onMouseDown={onShutterDown}
          onMouseUp={onShutterUp}
          onMouseLeave={onShutterUp}
          onTouchStart={onShutterDown}
          onTouchEnd={onShutterUp}
          onTouchCancel={onShutterUp}
          className={`w-20 h-20 rounded-full bg-white border-4 transition flex items-center justify-center ${burstActive ? "border-rose-500 scale-110" : "border-white/40 hover:scale-105"}`}
          aria-label="Capture (tap for single, hold for burst)"
          data-testid="burst-shutter"
        >
          {burstActive ? (
            <span className="text-ih-bad-fg text-xs font-bold animate-pulse">{burstCount} / 30</span>
          ) : (
            /* ds-allow: dark label on the white shutter button (fixed-dark camera overlay) */
            <span className="text-slate-700 text-[10px] font-bold tracking-widest uppercase">Shoot</span>
          )}
        </button>

        {captures.length > 0 ? (
          <button type="button" onClick={commit} className="px-5 py-2.5 rounded-full bg-ih-primary text-white text-sm font-bold shadow-ih-popover hover:bg-ih-primary-600" data-testid="burst-done">
            {uploading ? "Uploading..." : "Done"}
          </button>
        ) : <div className="w-20" />}
      </div>
    </div>
  );
}
