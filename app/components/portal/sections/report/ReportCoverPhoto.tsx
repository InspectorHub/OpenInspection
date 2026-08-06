/**
 * <ReportCoverPhoto> — the inspector-chosen cover image (DB-16) and its
 * failure fallback (Plan 1 / N1).
 *
 * The two belong in one component because the failure is the whole point: when
 * the image cannot load — typically because the photo was deleted after the
 * report was published — we swap in a restrained placeholder rather than
 * hiding the section, so the report never looks half-broken to the client. The
 * `coverFailed` flag is React state, never a DOM mutation, and it is local to
 * this block: nothing else on the report reads it.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { useState } from "react";
import { m } from "~/paraglide/messages";

/**
 * Restrained fallback shown in place of the report cover photo when the
 * underlying image fails to load (e.g. the photo was removed after the
 * report was published). We render a calm panel rather than hiding the
 * cover section, so the report never looks half-broken to the client.
 */
function CoverPhotoPlaceholder() {
  return (
    <div className="w-full h-44 sm:h-56 rounded-xl border border-ih-border bg-ih-bg-muted flex flex-col items-center justify-center gap-2 text-ih-fg-4">
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <span className="text-xs font-medium tracking-wide">{m.report_view_cover_unavailable()}</span>
    </div>
  );
}

export function ReportCoverPhoto({
  coverPhotoUrl,
  address,
  printMode,
}: {
  coverPhotoUrl: string | null;
  address: string;
  printMode: boolean;
}) {
  const [coverFailed, setCoverFailed] = useState(false);
  if (!coverPhotoUrl) return null;
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 mb-6">
      {coverFailed ? (
        <CoverPhotoPlaceholder />
      ) : (
        <img
          src={`${coverPhotoUrl}&w=1600`}
          alt={`Cover photo — ${address}`}
          // Fixed height (matching CoverPhotoPlaceholder) reserves the banner
          // box before the image loads, so it never reflows content downward
          // on load (no CLS) and the loaded/error states share one layout.
          className="h-44 w-full sm:h-56 object-cover rounded-xl border border-ih-border"
          loading={printMode ? "eager" : "lazy"}
          onError={() => setCoverFailed(true)}
        />
      )}
    </div>
  );
}
