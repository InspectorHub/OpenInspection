/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

export interface ItemOptions {
 min?: number | null;
 max?: number | null;
 unit?: string;
 step?: number | null;
 placeholder?: string;
 maxLength?: number | null;
 choices?: string[];
 minPhotos?: number | null;
}

export interface CannedComment {
 id: string;
 title: string;
 comment: string;
 default?: boolean;
}

export interface TemplateItem {
 id: string;
 label: string;
 type: "text" | "number" | "boolean" | "select" | "multi_select" | "textarea" | "date" | "photo_only" | "rich";
 description?: string;
 options?: ItemOptions;
 required?: boolean;
 isSafety?: boolean;
 ratingOptions?: string[];
 tabs?: {
 information?: CannedComment[];
 limitations?: CannedComment[];
 defects?: CannedComment[];
 };
}

export interface ItemResult {
 rating?: string | null;
 value?: string | boolean | number | null;
 notes?: string;
 photos?: { key: string }[];
}

/* ------------------------------------------------------------------ */
/* Field renderer */
/* ------------------------------------------------------------------ */

export function FormField({
 item,
 value,
 onChange,
}: {
 item: TemplateItem;
 value: string | boolean | number;
 onChange: (val: string | boolean | number) => void;
}) {
 const base =
 "w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[13px] focus:shadow-ih-focus focus:border-ih-primary outline-none";

 switch (item.type) {
 case "boolean":
 return (
 <label className="flex items-center gap-2">
 <input
 type="checkbox"
 checked={!!value}
 onChange={(e) => onChange(e.target.checked)}
 className="accent-ih-primary"
 />
 <span className="text-[13px] text-ih-fg-3">
 {item.label}
 </span>
 </label>
 );
 case "select":
 return (
 <select value={String(value || "")} onChange={(e) => onChange(e.target.value)} className={base}>
 <option value="">Select...</option>
 {item.options?.choices?.map((opt) => (
 <option key={opt} value={opt}>{opt}</option>
 ))}
 </select>
 );
 case "multi_select":
 return (
 <select
 multiple
 value={String(value || "").split(",").filter(Boolean)}
 onChange={(e) => {
 const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
 onChange(selected.join(","));
 }}
 className={`${base} min-h-[80px]`}
 >
 {item.options?.choices?.map((opt) => (
 <option key={opt} value={opt}>{opt}</option>
 ))}
 </select>
 );
 case "textarea":
 return (
 <textarea
 value={String(value || "")}
 onChange={(e) => onChange(e.target.value)}
 rows={3}
 className={base}
 placeholder={item.options?.placeholder || item.label}
 maxLength={item.options?.maxLength ?? undefined}
 />
 );
 case "number":
 return (
 <input
 type="number"
 value={value === "" || value == null ? "" : Number(value)}
 onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")}
 className={base}
 placeholder={item.options?.placeholder || item.label}
 min={item.options?.min ?? undefined}
 max={item.options?.max ?? undefined}
 step={item.options?.step ?? undefined}
 />
 );
 case "date":
 return (
 <input
 type="date"
 value={String(value || "")}
 onChange={(e) => onChange(e.target.value)}
 className={base}
 />
 );
 case "photo_only":
 return (
 <div className="p-4 rounded-lg border border-dashed border-ih-border-strong text-center text-[13px] text-ih-fg-4">
 Photo capture is available in the inspection editor
 </div>
 );
 case "rich":
 return null; // Handled by RichItemRenderer
 default:
 return (
 <input
 type="text"
 value={String(value || "")}
 onChange={(e) => onChange(e.target.value)}
 className={base}
 placeholder={item.options?.placeholder || item.label}
 maxLength={item.options?.maxLength ?? undefined}
 />
 );
 }
}
