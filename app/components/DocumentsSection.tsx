/**
 * Shared per-inspection documents area (unified client portal, section ⑦).
 *
 * Used by BOTH the inspector inspection-hub AND the client portal Hub. Pure
 * presentational + helpers — NO data fetching inside. All upload / delete /
 * download actions are passed in as callbacks/hrefs by the host route.
 *
 * Helpers (`isAcceptedDocument`, `formatSize`, `groupByCategory`) mirror the
 * server allowlist in `server/services/client-document.service.ts` so the UI can
 * reject obviously-invalid files BEFORE streaming them (the server still
 * re-validates by construction).
 *
 * lint:ds — literal colors are forbidden; only `ih-*` design tokens are used.
 */
import { useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { formatDate } from "~/lib/format";
import { useDisplayLocale, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/* Allowlist (mirrors server/services/client-document.service.ts) */
/* ------------------------------------------------------------------ */

export const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

export const ACCEPTED_EXTENSIONS = new Set([
  "pdf", "jpg", "jpeg", "png", "heic", "heif", "webp",
  "doc", "docx", "xls", "xlsx", "csv", "dwg", "dxf",
]);
export const CAD_EXTENSIONS = new Set(["dwg", "dxf"]);
export const ACCEPTED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);

const extOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase();

/**
 * Accept iff the extension is allowed AND (it is a CAD extension OR the MIME is
 * in the allowlist) AND the size is within the cap. CAD files (.dwg/.dxf) are
 * accepted by extension because browsers report them as
 * `application/octet-stream`.
 */
export function isAcceptedDocument(file: { name: string; type: string; size: number }): boolean {
  const ext = extOf(file.name);
  if (!ACCEPTED_EXTENSIONS.has(ext)) return false;
  if (!CAD_EXTENSIONS.has(ext) && !ACCEPTED_CONTENT_TYPES.has(file.type)) return false;
  if (file.size > MAX_BYTES) return false;
  return true;
}

/** Human-readable byte size: 1536 → "1.5 KB", 5 MB → "5.0 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */
/* Categories */
/* ------------------------------------------------------------------ */

export const DOCUMENT_CATEGORIES = [
  "prior_reports", "plans_drawings", "environmental",
  "leases_financials", "permits_certificates", "photos", "other",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

// Labels are exposed as getters so each resolves at access time under the active
// paraglide locale; the category ids/keys are unchanged (used as React keys + values).
export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  get prior_reports() { return m.label_doccategory_prior_reports(); },
  get plans_drawings() { return m.label_doccategory_plans_drawings(); },
  get environmental() { return m.label_doccategory_environmental(); },
  get leases_financials() { return m.label_doccategory_leases_financials(); },
  get permits_certificates() { return m.label_doccategory_permits_certificates(); },
  get photos() { return m.label_doccategory_photos(); },
  get other() { return m.label_doccategory_other(); },
};

export type DocumentVisibility = "client_visible" | "internal";

export interface DocumentItem {
  id: string;
  filename: string;
  category: DocumentCategory;
  sizeBytes: number;
  createdAt: number;
  uploadedByKind: "client" | "co_client" | "inspector";
  uploadedByName: string | null;
  visibility: DocumentVisibility;
  label: string | null;
  /** Client list returns this (own = deletable). */
  isOwn?: boolean;
  /** Inspector list returns this (compared to currentUserRef). */
  uploadedByRef?: string;
}

export interface DocumentGroup {
  category: DocumentCategory;
  label: string;
  items: DocumentItem[];
}

/**
 * Group items by category in DOCUMENT_CATEGORIES order, omitting empty
 * categories. Order within a group preserves the input order.
 */
export function groupByCategory(items: DocumentItem[]): DocumentGroup[] {
  return DOCUMENT_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    items: items.filter((i) => i.category === category),
  })).filter((g) => g.items.length > 0);
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

const ACCEPT_ATTR = Array.from(ACCEPTED_EXTENSIONS).map((e) => `.${e}`).join(",");

export interface DocumentsSectionProps {
  items: DocumentItem[];
  canUpload: boolean;
  showVisibilityToggle?: boolean;
  allowDeleteAny?: boolean;
  currentUserRef?: string;
  downloadHref: (id: string) => string;
  onUpload: (
    file: File,
    opts: { category: DocumentCategory; visibility: DocumentVisibility; label?: string },
  ) => void;
  onDelete: (id: string) => void;
  uploading?: boolean;
  error?: string | null;
}

/** A row is deletable in the client list (isOwn) OR the inspector list (uploadedByRef === currentUserRef) OR when allowDeleteAny. */
function isDeletable(item: DocumentItem, allowDeleteAny: boolean, currentUserRef?: string): boolean {
  return (
    allowDeleteAny === true ||
    item.isOwn === true ||
    (currentUserRef != null && item.uploadedByRef != null && item.uploadedByRef === currentUserRef)
  );
}

function uploaderLabel(item: DocumentItem): string {
  if (item.uploadedByName) return item.uploadedByName;
  return item.uploadedByKind === "inspector" ? m.documents_uploader_inspector() : m.documents_uploader_client();
}

export default function DocumentsSection({
  items,
  canUpload,
  showVisibilityToggle = false,
  allowDeleteAny = false,
  currentUserRef,
  downloadHref,
  onUpload,
  onDelete,
  uploading = false,
  error = null,
}: DocumentsSectionProps) {
  const locale = useDisplayLocale();
  const tz = useDisplayTimeZone();
  const [category, setCategory] = useState<DocumentCategory>("prior_reports");
  const [visibility, setVisibility] = useState<DocumentVisibility>("client_visible");
  const [label, setLabel] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const groups = groupByCategory(items);

  const handleFile = (file: File | undefined | null) => {
    if (!file) return;
    if (!isAcceptedDocument(file)) {
      setLocalError(m.documents_error_rejected());
      return;
    }
    setLocalError(null);
    onUpload(file, { category, visibility, label: label.trim() || undefined });
    setLabel("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const shownError = error ?? localError;

  return (
    <section className="rounded-xl border border-ih-border bg-ih-bg-card p-5">
      <h2 className="text-sm font-bold text-ih-fg-1">{m.documents_heading()}</h2>
      <p className="mt-0.5 text-[12px] text-ih-fg-3">
        {m.documents_description()}
      </p>

      {canUpload && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-3">{m.documents_category_label()}</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as DocumentCategory)}
                disabled={uploading}
                className="rounded-md border border-ih-border bg-ih-bg-card px-2 py-1.5 text-[13px] text-ih-fg-1 disabled:opacity-50"
              >
                {DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </label>

            {showVisibilityToggle && (
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-3">{m.documents_visibility_label()}</span>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as DocumentVisibility)}
                  disabled={uploading}
                  className="rounded-md border border-ih-border bg-ih-bg-card px-2 py-1.5 text-[13px] text-ih-fg-1 disabled:opacity-50"
                >
                  <option value="client_visible">{m.documents_visibility_client()}</option>
                  <option value="internal">{m.documents_visibility_internal()}</option>
                </select>
              </label>
            )}

            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-3">{m.documents_label_optional()}</span>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={uploading}
                placeholder={m.documents_label_placeholder()}
                className="rounded-md border border-ih-border bg-ih-bg-card px-2 py-1.5 text-[13px] text-ih-fg-1 placeholder:text-ih-fg-3 disabled:opacity-50"
              />
            </label>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (!uploading) handleFile(e.dataTransfer.files?.[0]);
            }}
            className={`mt-3 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragOver ? "border-ih-primary bg-ih-bg-muted" : "border-ih-border bg-ih-bg-muted"
            }`}
          >
            {uploading ? (
              <span className="text-[13px] font-semibold text-ih-fg-2">{m.documents_uploading()}</span>
            ) : (
              <>
                <span className="text-[13px] text-ih-fg-2">{m.documents_drag()}</span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-md bg-ih-primary px-3 py-1.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90"
                >
                  {m.documents_choose_file()}
                </button>
                <span className="text-[11px] text-ih-fg-3">{ACCEPT_ATTR.replace(/\./g, "").replace(/,/g, ", ")}</span>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              disabled={uploading}
              onChange={(e) => handleFile(e.target.files?.[0])}
              className="hidden"
            />
          </div>

          {shownError && (
            <p className="mt-2 text-[12px] font-semibold text-ih-bad-fg">{shownError}</p>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-5">
        {groups.length === 0 ? (
          <p className="rounded-lg bg-ih-bg-muted px-4 py-6 text-center text-[13px] text-ih-fg-3">
            {m.documents_empty()}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.category}>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-ih-fg-3">
                {group.label}
              </h3>
              <ul className="mt-2 divide-y divide-ih-border rounded-lg border border-ih-border">
                {group.items.map((item) => {
                  const deletable = isDeletable(item, allowDeleteAny, currentUserRef);
                  return (
                    <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <a
                          href={downloadHref(item.id)}
                          className="block truncate text-[13px] font-semibold text-ih-primary hover:underline"
                        >
                          {item.label || item.filename}
                        </a>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ih-fg-3">
                          <span>{formatSize(item.sizeBytes)}</span>
                          <span aria-hidden>·</span>
                          <span>{uploaderLabel(item)}</span>
                          <span aria-hidden>·</span>
                          <span>{formatDate(item.createdAt, { locale, timeZone: tz, month: "short" })}</span>
                          {item.visibility === "internal" && (
                            <span className="rounded bg-ih-watch-bg px-1.5 py-0.5 font-bold text-ih-watch-fg">
                              {m.documents_internal_badge()}
                            </span>
                          )}
                        </div>
                      </div>
                      {deletable && (
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(item.id)}
                          className="shrink-0 rounded-md px-2 py-1 text-[12px] font-bold text-ih-bad-fg transition-colors hover:bg-ih-bad-bg"
                        >
                          {m.common_delete()}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      <ConfirmDialog
        open={pendingDeleteId != null}
        title={m.documents_delete_title()}
        message={m.documents_delete_message()}
        confirmLabel={m.common_delete()}
        onConfirm={() => {
          if (pendingDeleteId != null) onDelete(pendingDeleteId);
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </section>
  );
}
