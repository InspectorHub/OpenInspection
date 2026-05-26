export interface RatingLevel {
  id: string;
  label: string;
  abbreviation: string;
  color: string;
}

const DEFAULT_LEVELS: RatingLevel[] = [
  { id: "Satisfactory",   label: "Satisfactory",   abbreviation: "SAT", color: "var(--ih-status-ok, #10b981)" },
  { id: "Monitor",        label: "Monitor",        abbreviation: "MON", color: "var(--ih-status-watch, #f59e0b)" },
  { id: "Defect",         label: "Defect",         abbreviation: "DEF", color: "var(--ih-status-bad, #ef4444)" },
  { id: "Not Inspected",  label: "Not Inspected",  abbreviation: "N/I", color: "#3b82f6" },
];

interface RatingButtonsProps {
  levels?: RatingLevel[];
  value?: string;
  size?: "sm" | "md";
  onChange?: (levelId: string) => void;
}

export function RatingButtons({ levels, value, size = "md", onChange }: RatingButtonsProps) {
  const effectiveLevels = levels && levels.length > 0 ? levels : DEFAULT_LEVELS;
  const btnSize = size === "sm" ? "px-2.5 py-1 text-[10px]" : "px-3.5 py-1.5 text-xs";

  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Rating">
      {effectiveLevels.map((level) => {
        const isActive = value === level.id;
        return (
          <button
            key={level.id}
            type="button"
            onClick={() => onChange?.(level.id)}
            className={`${btnSize} font-semibold rounded-lg border transition-all duration-150 cursor-pointer ${isActive ? "text-white border-transparent shadow-sm" : "border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600"}`}
            style={isActive ? { background: level.color } : undefined}
            aria-label={level.label}
            title={level.label}
          >
            {level.abbreviation}
          </button>
        );
      })}
    </div>
  );
}
