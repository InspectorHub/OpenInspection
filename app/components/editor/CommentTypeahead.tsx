// app/components/editor/CommentTypeahead.tsx
import type { TypeaheadEntry } from "../../lib/comment-typeahead";
import { m } from "~/paraglide/messages";

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

export function CommentTypeahead({
  matches, open, selectedIndex, onHoverIndex, onPick,
}: CommentTypeaheadProps) {
  // Built in render so the message functions resolve per-render (never frozen
  // at import).
  const KIND_LABEL: Record<string, string> = {
    defect: m.editor_typeahead_kind_defect(),
    information: m.editor_typeahead_kind_info(),
    limitations: m.editor_typeahead_kind_limitations(),
  };
  if (!open || matches.length === 0) return null;
  return (
    <ul
      role="listbox"
      className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg border border-ih-border bg-ih-bg-card shadow-ih-popover"
    >
      {matches.map((match, i) => (
        <li
          key={match.id}
          role="option"
          aria-selected={i === selectedIndex}
          onMouseEnter={() => onHoverIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault(); // keep textarea focus
          }}
          onClick={() => {
            onPick(match.comment);
          }}
          className={`cursor-pointer px-3 py-2 border-b border-ih-border last:border-b-0 ${
            i === selectedIndex ? "bg-ih-primary-tint" : "hover:bg-ih-bg-muted"
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-bold text-ih-fg-2">{match.title}</span>
            {match.abbrev && (
              <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-ih-bg-muted text-ih-fg-4">
                {match.abbrev}
              </span>
            )}
            {match.kind && (
              <span className="ml-auto text-[9px] uppercase tracking-wider text-ih-fg-4">
                {KIND_LABEL[match.kind]}
              </span>
            )}
          </div>
          <p className="text-[11px] text-ih-fg-3 mt-0.5 line-clamp-2">{match.comment}</p>
        </li>
      ))}
    </ul>
  );
}
