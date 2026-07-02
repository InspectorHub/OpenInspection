// app/components/editor/CommentTypeahead.tsx
import type { TypeaheadEntry } from "../../lib/comment-typeahead";

interface CommentTypeaheadProps {
  entries: TypeaheadEntry[];   // kept for parity with callers; not read directly
  matches: TypeaheadEntry[];
  query: string;
  open: boolean;
  selectedIndex: number;
  onHoverIndex: (i: number) => void;
  onPick: (text: string) => void;
  onClose: () => void;
}

const KIND_LABEL: Record<string, string> = {
  defect: "Defect", information: "Info", limitations: "Limitation",
};

export function CommentTypeahead({
  matches, open, selectedIndex, onHoverIndex, onPick,
}: CommentTypeaheadProps) {
  if (!open || matches.length === 0) return null;
  return (
    <ul
      role="listbox"
      className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg border border-ih-border bg-ih-bg-card shadow-ih-popover"
    >
      {matches.map((m, i) => (
        <li
          key={m.id}
          role="option"
          aria-selected={i === selectedIndex}
          onMouseEnter={() => onHoverIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault(); // keep textarea focus
          }}
          onClick={() => {
            onPick(m.comment);
          }}
          className={`cursor-pointer px-3 py-2 border-b border-ih-border last:border-b-0 ${
            i === selectedIndex ? "bg-ih-primary-tint" : "hover:bg-ih-bg-muted"
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-bold text-ih-fg-2">{m.title}</span>
            {m.abbrev && (
              <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-ih-bg-muted text-ih-fg-4">
                {m.abbrev}
              </span>
            )}
            {m.kind && (
              <span className="ml-auto text-[9px] uppercase tracking-wider text-ih-fg-4">
                {KIND_LABEL[m.kind]}
              </span>
            )}
          </div>
          <p className="text-[11px] text-ih-fg-3 mt-0.5 line-clamp-2">{m.comment}</p>
        </li>
      ))}
    </ul>
  );
}
