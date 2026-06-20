import type { EditorRatingLevel } from "../../lib/rating-levels";

/* Solid active fills — readable in direct sunlight (field eval FE/C-14a).
 * DS tokens flip in dark mode automatically; the `minor` active fill uses the
 * inverse pair so its solid chip stays high-contrast in both themes. */
const SEVERITY_STYLES: Record<string, { active: string; idle: string }> = {
  good: {
    active: "bg-ih-ok text-white ring-2 ring-ih-ok/40",
    idle: "bg-ih-ok-bg text-ih-ok-fg hover:bg-ih-ok/20",
  },
  marginal: {
    active: "bg-ih-watch text-white ring-2 ring-ih-watch/40",
    idle: "bg-ih-watch-bg text-ih-watch-fg hover:bg-ih-watch/20",
  },
  significant: {
    active: "bg-ih-bad text-white ring-2 ring-ih-bad/40",
    idle: "bg-ih-bad-bg text-ih-bad-fg hover:bg-ih-bad/20",
  },
  minor: {
    active: "bg-ih-bg-inverse text-ih-fg-inverse ring-2 ring-ih-border-strong",
    idle: "bg-ih-bg-muted text-ih-fg-2 hover:bg-ih-border",
  },
};

export interface RatingButtonRowProps {
  levels: EditorRatingLevel[];
  activeLevel: EditorRatingLevel | null | undefined;
  onRating: (rating: string) => void;
}

/* Rating buttons — driven by the rating system's levels (C-14a):
   full words on ≥sm, abbreviation on narrow, always-on semantic colour. */
export function RatingButtonRow({ levels, activeLevel, onRating }: RatingButtonRowProps) {
  return (
    // FE-4 — gap-3 (12px) between rating buttons: adjacent mis-taps were the
    // top field complaint; buttons themselves are already 52px tall.
    <div data-shortcut-scope className="flex gap-3">
      {levels.map((r, idx) => {
        const sev = SEVERITY_STYLES[r.severity ?? "minor"] ?? SEVERITY_STYLES.minor;
        const isActive = activeLevel?.id === r.id;
        const full = r.label ?? r.name ?? r.id;
        const abbr = r.abbreviation ?? full;
        return (
          <button
            key={r.id}
            onClick={() => onRating(r.id)}
            title={`${full} (${idx + 1})`}
            aria-pressed={isActive}
            className={`flex-1 min-w-0 h-[52px] rounded-lg text-[13px] font-bold transition-all ${
              isActive ? sev.active : sev.idle
            }`}
          >
            <span className="hidden sm:inline truncate px-1">{full}</span>
            <span className="sm:hidden">{abbr}</span>
            <span className="block text-[9px] font-mono opacity-60 mt-0.5">{idx + 1}</span>
          </button>
        );
      })}
    </div>
  );
}
