import type { ItemResult, TemplateItem } from "./FormField";

/* ---- Rich item renderer (rating + notes) ---- */
export function RichItemRenderer({
 item,
 result,
 onRatingChange,
 onNotesChange,
 ratingOptions,
}: {
 item: TemplateItem;
 result: ItemResult;
 onRatingChange: (rating: string) => void;
 onNotesChange: (notes: string) => void;
 ratingOptions: string[];
}) {
 return (
 <div className="space-y-2">
 {/* Rating buttons */}
 <div className="flex flex-wrap gap-1.5">
 {ratingOptions.map((opt) => (
 <button
 key={opt}
 type="button"
 onClick={() => onRatingChange(opt)}
 className={`px-3 py-1.5 rounded-md text-[11px] font-bold border transition-colors ${
 result.rating === opt
 ? "border-ih-primary bg-ih-primary-tint text-ih-primary"
 : "border-ih-border text-ih-fg-3 hover:border-ih-border-strong"
 }`}
 >
 {opt}
 </button>
 ))}
 </div>
 {/* Notes */}
 <textarea
 value={result.notes || ""}
 onChange={(e) => onNotesChange(e.target.value)}
 rows={2}
 placeholder="Notes..."
 className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[13px] focus:shadow-ih-focus focus:border-ih-primary outline-none"
 />
 {/* Canned comments (quick insert) */}
 {item.tabs && (
 <div className="flex flex-wrap gap-1">
 {(["information", "limitations", "defects"] as const).map((tab) =>
 (item.tabs?.[tab] || []).filter((c) => c.default).map((c) => (
 <button
 key={c.id}
 type="button"
 onClick={() => onNotesChange((result.notes || "") + (result.notes ? "\n" : "") + c.comment)}
 className="text-[10px] px-2 py-0.5 rounded bg-ih-bg-muted text-ih-fg-3 hover:bg-ih-primary-tint hover:text-ih-primary transition-colors"
 title={c.comment}
 >
 {c.title || c.comment.slice(0, 30)}
 </button>
 )),
 )}
 </div>
 )}
 </div>
 );
}
