import React, { useCallback, useRef, useState } from "react";
import { Button } from "./Button";

/**
 * FileDropzone — DS 0523 file picker with a real state machine:
 *
 *   idle → drag-over (marching-ants dashes + primary tint)
 *        → busy (async parse feedback: ExcelJS lazy-load etc.)
 *        → selected (zone collapses to a file chip with clear)
 *        → error (inline alert; zone stays interactive for retry)
 *
 * Controlled display: the CALLER owns parsing/validation and feeds back
 * `fileName`/`busy`/`error`. No drag-time MIME sniffing — type errors
 * surface after drop through the caller's error prop.
 *
 * Design: docs/superpowers/specs (superproject) 2026-06-07-shared-ui-filedropzone-design.md
 */
export interface FileDropzoneProps {
  accept?: string;
  /** Single file (multiple is a future need — photo upload would want it). */
  onFile: (file: File) => void;
  /** Controlled: the selected file's display name (null/empty = none). */
  fileName?: string | null;
  /** Controlled: selected file's size in bytes, for the chip. */
  fileSize?: number | null;
  /** Async parse in flight — shows the busy row, disables interaction. */
  busy?: boolean;
  error?: string | null;
  /** Secondary line inside the zone, e.g. "CSV or Excel (.xlsx)". */
  hint?: string;
  disabled?: boolean;
  onClear?: () => void;
}

/** First file of a drop's DataTransfer, or null. */
export function firstFileFromDrop(dt: DataTransfer | null): File | null {
  return dt?.files?.[0] ?? null;
}

/** 512 B / 6.9 KB / 240 KB / 1.5 MB — one decimal only below 10 units. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** Middle-truncate a filename to maxLen, preserving the extension. */
export function truncateMiddle(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const room = maxLen - ext.length - 1; // 1 for the ellipsis
  if (room < 4) return `${name.slice(0, maxLen - 1)}…`;
  const head = Math.ceil(room * 0.7);
  const tail = room - head;
  return `${stem.slice(0, head)}…${tail > 0 ? stem.slice(-tail) : ""}${ext}`;
}

export function FileDropzone({
  accept,
  onFile,
  fileName,
  fileSize,
  busy = false,
  error,
  hint,
  disabled = false,
  onClear,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  // dragenter/dragleave fire for every child crossing — count the depth so
  // the highlight doesn't flicker while moving across inner elements.
  const dragDepth = useRef(0);

  const interactive = !disabled && !busy;
  const selected = !!fileName && !busy;

  const openPicker = useCallback(() => {
    if (interactive) inputRef.current?.click();
  }, [interactive]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      if (!interactive) return;
      const file = firstFileFromDrop(e.dataTransfer);
      if (file) onFile(file);
    },
    [interactive, onFile],
  );

  const borderColor = error
    ? "text-ih-bad"
    : dragOver
      ? "text-ih-primary"
      : "text-ih-border-strong";

  return (
    <div>
      <div
        role="button"
        tabIndex={interactive ? 0 : -1}
        aria-label="Choose a file or drag one here"
        aria-busy={busy || undefined}
        aria-disabled={!interactive || undefined}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!interactive) return;
          dragDepth.current += 1;
          setDragOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragOver(false);
        }}
        onDrop={handleDrop}
        className={`relative rounded-md px-4 py-5 min-h-11 transition-colors focus:outline-none focus:shadow-ih-focus ${
          dragOver ? "bg-ih-primary-tint" : "bg-ih-bg-card"
        } ${interactive ? "cursor-pointer" : "opacity-60 cursor-not-allowed"}`}
      >
        {/* Dashed frame as SVG so drag-over can run the marching-ants
            animation on stroke-dashoffset (motion-safe only). */}
        <svg
          aria-hidden="true"
          className={`absolute inset-0 h-full w-full pointer-events-none ${borderColor}`}
        >
          <rect
            x="1"
            y="1"
            width="calc(100% - 2px)"
            height="calc(100% - 2px)"
            rx="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="8 6"
            className={dragOver ? "motion-safe:animate-ih-dash-march" : ""}
          />
        </svg>

        {busy ? (
          <div className="flex items-center justify-center gap-2.5 text-[13px] text-ih-fg-2">
            <span className="h-4 w-4 rounded-full border-2 border-ih-border border-t-ih-primary animate-spin" />
            Reading file…
          </div>
        ) : selected ? (
          <div className="flex items-center justify-center gap-2.5 animate-ih-ok-flash rounded-md">
            <svg className="h-4 w-4 text-ih-fg-4 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 1.5h5.5L13 5v9.5H4v-13Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M9.5 1.5V5H13" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            <span className="text-[13px] font-bold text-ih-fg-2" title={fileName ?? undefined}>
              {truncateMiddle(fileName ?? "", 34)}
            </span>
            {typeof fileSize === "number" && (
              <span className="text-[11px] text-ih-fg-4">{formatFileSize(fileSize)}</span>
            )}
            {onClear && (
              <button
                type="button"
                aria-label="Clear selected file"
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                className="ml-1 h-6 w-6 inline-flex items-center justify-center rounded text-ih-fg-4 hover:text-ih-fg-1 hover:bg-ih-bg-muted focus:outline-none focus:shadow-ih-focus"
              >
                ✕
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-center">
            <div className="flex items-center gap-2 text-[13px] text-ih-fg-2">
              <svg
                className={`h-4 w-4 transition-transform ${dragOver ? "-translate-y-0.5 text-ih-primary" : "text-ih-fg-4"}`}
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path d="M8 11V3m0 0L4.5 6.5M8 3l3.5 3.5M2.5 13.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>
                Drop your file here, or{" "}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    openPicker();
                  }}
                  disabled={!interactive}
                >
                  Choose file
                </Button>
              </span>
            </div>
            {hint && <p className="text-[11px] text-ih-fg-3">{hint}</p>}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          disabled={!interactive}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            // allow re-selecting the same file after a clear
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <p role="alert" className="mt-1.5 text-xs text-ih-bad-fg">
          {error}
        </p>
      )}
    </div>
  );
}
