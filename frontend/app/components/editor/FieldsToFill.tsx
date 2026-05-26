interface FieldPlaceholder {
  tag: string;
  index: number;
  length: number;
}

interface FieldsToFillProps {
  fields: FieldPlaceholder[];
  onJumpToField?: (index: number, length: number) => void;
}

export function FieldsToFill({ fields, onJumpToField }: FieldsToFillProps) {
  if (fields.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 px-2.5 py-2 rounded-lg border border-dashed"
      style={{ borderColor: "var(--ih-primary, #6366f1)", background: "var(--ih-primary-tint, rgba(99,102,241,0.1))" }}
    >
      <span className="ih-eyebrow flex-shrink-0" style={{ color: "var(--ih-primary, #6366f1)" }}>
        Fields to fill
      </span>

      {fields.map((f, i) => (
        <button
          key={`${f.tag}-${i}`}
          type="button"
          onClick={() => onJumpToField?.(f.index, f.length)}
          className="inline-flex items-center px-1.5 py-0.5 rounded border border-dashed text-[11px] font-mono font-bold cursor-pointer transition-colors"
          style={{ borderColor: "var(--ih-primary, #6366f1)", color: "var(--ih-primary, #6366f1)", background: "var(--ih-primary-tint, rgba(99,102,241,0.1))" }}
        >
          [{f.tag}]
        </button>
      ))}

      <span className="ml-auto text-[10px] text-ih-fg-4 flex-shrink-0">
        <kbd className="ih-kbd">Tab</kbd> next · <kbd className="ih-kbd">Shift+Tab</kbd> prev
      </span>
    </div>
  );
}
