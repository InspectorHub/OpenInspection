import { Modal } from "@core/shared-ui";
import { RATING_PRESETS } from "./types";
import type { RatingSystem } from "./types";

export interface RatingSystemModalProps {
  open: boolean;
  ratingSystem: RatingSystem;
  setRatingSystem: React.Dispatch<React.SetStateAction<RatingSystem>>;
  applyPreset: (preset: typeof RATING_PRESETS[0]) => void;
  addRatingLevel: () => void;
  onClose: () => void;
}

export function RatingSystemModal({ open, ratingSystem, setRatingSystem, applyPreset, addRatingLevel, onClose }: RatingSystemModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rating System"
      size="lg"
      footer={
        <button onClick={onClose} className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600">
          Done
        </button>
      }
    >
      {/* Presets */}
      <div className="flex flex-wrap gap-2 mb-4">
        {RATING_PRESETS.map((p) => (
          <button key={p.name} onClick={() => applyPreset(p)} className="text-[11px] font-bold px-2.5 py-1 rounded-md border border-ih-border text-ih-fg-3 hover:border-ih-primary hover:text-ih-primary transition-colors">
            {p.name}
          </button>
        ))}
      </div>
      {/* Levels */}
      <div className="space-y-2">
        {ratingSystem.levels.map((level, li) => (
          <div key={level.id + li} className="flex items-center gap-2 p-2 rounded-lg border border-ih-border">
            <input
              type="color"
              value={level.color || "#6b7280"}
              onChange={(e) => {
                const next = structuredClone(ratingSystem);
                next.levels[li].color = e.target.value;
                setRatingSystem(next);
              }}
              className="w-6 h-6 rounded border-0 cursor-pointer"
            />
            <input
              value={level.label}
              onChange={(e) => {
                const next = structuredClone(ratingSystem);
                next.levels[li].label = e.target.value;
                setRatingSystem(next);
              }}
              className="flex-1 text-[12px] font-bold bg-transparent outline-none text-ih-fg-1"
            />
            <input
              value={level.abbreviation || ""}
              onChange={(e) => {
                const next = structuredClone(ratingSystem);
                next.levels[li].abbreviation = e.target.value;
                setRatingSystem(next);
              }}
              placeholder="Abbr"
              className="w-12 text-[10px] font-mono bg-transparent border-b border-ih-border outline-none text-ih-fg-3 text-center"
            />
            <label className="flex items-center gap-1 text-[10px] text-ih-fg-3">
              <input
                type="checkbox"
                checked={!!level.isDefect}
                onChange={(e) => {
                  const next = structuredClone(ratingSystem);
                  next.levels[li].isDefect = e.target.checked;
                  setRatingSystem(next);
                }}
                className="accent-ih-bad-fg"
              />
              Defect
            </label>
            <button
              onClick={() => {
                const next = structuredClone(ratingSystem);
                next.levels.splice(li, 1);
                setRatingSystem(next);
              }}
              className="text-ih-fg-4 hover:text-ih-bad-fg text-[10px]"
            >&times;</button>
          </div>
        ))}
      </div>
      <button onClick={addRatingLevel} className="mt-3 text-[12px] font-bold text-ih-primary hover:text-ih-primary">
        + Add level
      </button>
    </Modal>
  );
}
