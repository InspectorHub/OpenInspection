import { formatRelativeTime } from "~/lib/format";
import { m } from "~/paraglide/messages";

export interface CommentLibraryListProps {
  /** `lastUsedAt` is the ISO string the comments API serializes, not epoch ms. */
  serverComments: Array<{ id: string; text: string; useCount?: number; lastUsedAt?: string | null }>;
  selectedIndex: number;
  sort: string;
  onInsertText: (text: string, id: string) => void;
  locale: string;
  /** Injected by tests; production reads the clock at render time. */
  now?: number;
}

export function CommentLibraryList({ serverComments, selectedIndex, sort, onInsertText, locale, now }: CommentLibraryListProps) {
  if (serverComments.length === 0) {
    return <p className="text-[13px] text-ih-fg-3 text-center py-8">{m.editor_comment_list_empty()}</p>;
  }
  return (
    <ul className="divide-y divide-ih-border">
      {serverComments.map((c, idx) => (
        <li
          key={c.id}
          onClick={() => onInsertText(c.text, c.id)}
          className={`cursor-pointer ${idx === selectedIndex ? "bg-ih-primary-tint ring-1 ring-inset ring-ih-primary/30" : ""}`}
        >
          <div className="flex items-start gap-2 p-2.5 hover:bg-ih-bg-muted">
            <p className="flex-1 text-[12px] text-ih-fg-2 leading-relaxed">{c.text}</p>
            <span className="text-[10px] text-ih-fg-4 tabular-nums whitespace-nowrap">
              {sort === "recent" && c.lastUsedAt
                ? formatRelativeTime(c.lastUsedAt, { locale, ...(now === undefined ? {} : { now }) })
                : ""}
              {sort === "frequent" && c.useCount ? `${c.useCount}×` : ""}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
