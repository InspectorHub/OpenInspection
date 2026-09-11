import { m } from "~/paraglide/messages";

interface AnnotatorPlaceholderProps {
  /** What the inspector picked. Null means they picked nothing. */
  photoUrl: string | null;
  /** The request for `photoUrl` came back a failure. */
  failed: boolean;
  onRetry: () => void;
}

/**
 * What the photo studio's canvas area shows when there is no canvas.
 *
 * N6 — there used to be one placeholder here doing the work of three. "No photo
 * selected" is a statement about the inspector's SELECTION, and because a
 * failed image load left `image` null forever (no `onerror` anywhere), it was
 * the thing a photo that failed to load said too. A load still in flight said
 * it as well.
 *
 * So: three states, and the claim about the selection is made only when the
 * selection is genuinely empty. Same shape as the photo drawer (F57).
 */
export function AnnotatorPlaceholder({ photoUrl, failed, onRetry }: AnnotatorPlaceholderProps) {
  return (
    /* ds-allow: fixed-dark photo-studio chrome (white/* neutrals stay dark in both themes) */
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
        {!photoUrl ? (
          <>
            <p className="text-[13px]">{m.media_annotate_empty_title()}</p>
            <p className="text-[11px] mt-1">{m.media_annotate_empty_subtitle()}</p>
          </>
        ) : failed ? (
          <>
            <p className="text-[13px] text-white/70">{m.media_annotate_failed_title()}</p>
            <p className="text-[11px] mt-1">{m.media_annotate_failed_subtitle()}</p>
            {/* ds-allow: fixed-dark studio chrome — same white-alpha glass the
                rest of the annotator uses, in both themes. */}
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 h-8 px-3 rounded-md text-[12px] font-bold text-white/80 bg-white/10 border border-white/20 hover:bg-white/20 transition-colors"
            >
              {m.editor_collab_try_again()}
            </button>
          </>
        ) : (
          <p className="text-[13px]">{m.media_annotate_loading_title()}</p>
        )}
      </div>
    </div>
  );
}
