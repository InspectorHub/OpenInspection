import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Modal, Button } from "@core/shared-ui";

/* ------------------------------------------------------------------ */
/*  Types + presets (mirrors server CreateRatingSystemSchema)         */
/* ------------------------------------------------------------------ */

export type RatingBucket = "satisfactory" | "monitor" | "defect" | "na";

export interface EditorLevel {
  id?: string;
  abbr: string;
  label: string;
  color: string;
  bucket: RatingBucket;
  hotkey?: string;
}

export interface EditorSystem {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  isDefault?: boolean;
  levels: EditorLevel[];
}

const BUCKETS: { value: RatingBucket; label: string; dot: string }[] = [
  { value: "satisfactory", label: "Satisfactory", dot: "bg-ih-ok" },
  { value: "monitor", label: "Monitor", dot: "bg-ih-watch" },
  { value: "defect", label: "Defect", dot: "bg-ih-bad" },
  { value: "na", label: "N/A", dot: "bg-ih-fg-4" },
];

const PRESETS: { name: string; levels: EditorLevel[] }[] = [
  { name: "3-level", levels: [
    { abbr: "S", label: "Satisfactory", color: "#22c55e", bucket: "satisfactory", hotkey: "1" },
    { abbr: "M", label: "Monitor", color: "#f59e0b", bucket: "monitor", hotkey: "2" },
    { abbr: "D", label: "Defect", color: "#ef4444", bucket: "defect", hotkey: "3" },
  ] },
  { name: "5-level", levels: [
    { abbr: "Sat", label: "Satisfactory", color: "#22c55e", bucket: "satisfactory", hotkey: "1" },
    { abbr: "Mon", label: "Monitor", color: "#f59e0b", bucket: "monitor", hotkey: "2" },
    { abbr: "Def", label: "Defect", color: "#ef4444", bucket: "defect", hotkey: "3" },
    { abbr: "NI", label: "Not Inspected", color: "#9ca3af", bucket: "na", hotkey: "4" },
    { abbr: "NP", label: "Not Present", color: "#6b7280", bucket: "na", hotkey: "5" },
  ] },
  { name: "TREC", levels: [
    { abbr: "I", label: "Inspected", color: "#22c55e", bucket: "satisfactory", hotkey: "1" },
    { abbr: "D", label: "Deficient", color: "#ef4444", bucket: "defect", hotkey: "2" },
    { abbr: "NI", label: "Not Inspected", color: "#9ca3af", bucket: "na", hotkey: "3" },
    { abbr: "NP", label: "Not Present", color: "#6b7280", bucket: "na", hotkey: "4" },
  ] },
];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

const blankLevel = (): EditorLevel => ({ abbr: "", label: "", color: "#64748b", bucket: "satisfactory" });

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function RatingSystemEditor({
  open,
  onClose,
  system,
}: {
  open: boolean;
  onClose: () => void;
  system?: EditorSystem | null;
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const editing = !!system;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [levels, setLevels] = useState<EditorLevel[]>([]);
  const [slugTouched, setSlugTouched] = useState(false);
  const [slug, setSlug] = useState("");

  // Seed the form whenever the modal opens (new = 3-level preset, edit = the system).
  useEffect(() => {
    if (!open) return;
    if (system) {
      setName(system.name);
      setDescription(system.description ?? "");
      setIsDefault(!!system.isDefault);
      setLevels(system.levels.map((l) => ({ ...l })));
      setSlug(system.slug);
      setSlugTouched(true);
    } else {
      setName("");
      setDescription("");
      setIsDefault(false);
      setLevels(PRESETS[0].levels.map((l) => ({ ...l })));
      setSlug("");
      setSlugTouched(false);
    }
  }, [open, system]);

  // Auto-derive the slug from the name until the user edits it directly.
  const effectiveSlug = slugTouched ? slug : slugify(name);

  const saving = fetcher.state !== "idle";
  const submittedRef = useRef(false);
  useEffect(() => {
    if (submittedRef.current && fetcher.state === "idle" && fetcher.data?.ok) {
      submittedRef.current = false;
      onClose();
    }
  }, [fetcher.state, fetcher.data, onClose]);

  const error =
    !name.trim() ? "Name is required"
    : effectiveSlug.length < 2 ? "Name must produce a 2+ character slug"
    : levels.length < 2 ? "Add at least 2 levels"
    : levels.some((l) => !l.abbr.trim() || !l.label.trim()) ? "Every level needs an abbreviation and a label"
    : fetcher.data?.error ?? null;

  function patchLevel(idx: number, patch: Partial<EditorLevel>) {
    setLevels((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function moveLevel(idx: number, dir: -1 | 1) {
    setLevels((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  function save() {
    if (error && error !== fetcher.data?.error) return;
    submittedRef.current = true;
    fetcher.submit(
      {
        intent: "save",
        ...(system ? { id: system.id } : {}),
        name: name.trim(),
        slug: effectiveSlug,
        description: description.trim(),
        isDefault: String(isDefault),
        levels: JSON.stringify(
          levels.map((l, i) => ({
            ...(l.id ? { id: l.id } : {}),
            abbr: l.abbr.trim(),
            label: l.label.trim(),
            color: l.color,
            bucket: l.bucket,
            ...(l.hotkey ? { hotkey: l.hotkey } : {}),
            order: i,
          })),
        ),
      },
      { method: "post" },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit rating system" : "New rating system"}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving || (!!error && error !== fetcher.data?.error)}>
            {saving ? "Saving…" : editing ? "Save changes" : "Create system"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Identity */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-ih-fg-4 mb-1.5">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard 5-Level"
              className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:shadow-ih-focus focus:border-ih-primary outline-none"
            />
            {name.trim() && (
              <p className="mt-1 text-[11px] text-ih-fg-4 font-mono">/{effectiveSlug || "…"}</p>
            )}
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-ih-fg-4 mb-1.5">Description <span className="font-medium normal-case tracking-normal text-ih-fg-4">· optional</span></label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="When inspectors should reach for this scale"
              className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:shadow-ih-focus focus:border-ih-primary outline-none"
            />
          </div>
        </div>

        {/* Levels */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-ih-fg-4">
              Rating levels <span className="text-ih-fg-4 font-mono normal-case tracking-normal">· {levels.length}</span>
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-ih-fg-4 mr-1">Start from</span>
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setLevels(p.levels.map((l) => ({ ...l })))}
                  className="h-6 px-2 rounded text-[11px] font-bold text-ih-primary border border-ih-border hover:bg-ih-primary-tint transition-colors"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            {levels.map((lvl, i) => (
              <div
                key={i}
                className="flex items-center gap-2 p-1.5 pr-2 rounded-lg border border-ih-border bg-ih-bg-app/40 hover:bg-ih-bg-muted/50 transition-colors"
              >
                {/* Color swatch — the level's identity */}
                <label
                  className="relative w-9 h-9 rounded-md shrink-0 cursor-pointer ring-1 ring-inset ring-black/10 flex items-center justify-center text-[11px] font-extrabold text-white"
                  style={{ backgroundColor: lvl.color }}
                  title="Pick color"
                >
                  {lvl.abbr.slice(0, 3) || "·"}
                  <input
                    type="color"
                    value={lvl.color}
                    onChange={(e) => patchLevel(i, { color: e.target.value })}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    aria-label="Level color"
                  />
                </label>

                <input
                  value={lvl.abbr}
                  onChange={(e) => patchLevel(i, { abbr: e.target.value })}
                  placeholder="ABBR"
                  maxLength={8}
                  className="w-16 h-8 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold uppercase text-ih-fg-1 focus:shadow-ih-focus focus:border-ih-primary outline-none"
                />
                <input
                  value={lvl.label}
                  onChange={(e) => patchLevel(i, { label: e.target.value })}
                  placeholder="Full label, e.g. Satisfactory"
                  maxLength={40}
                  className="flex-1 min-w-0 h-8 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:shadow-ih-focus focus:border-ih-primary outline-none"
                />

                {/* Bucket — drives report grouping + defect rollups */}
                <div className="relative shrink-0">
                  <span
                    className={`absolute left-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full pointer-events-none ${BUCKETS.find((b) => b.value === lvl.bucket)?.dot}`}
                  />
                  <select
                    value={lvl.bucket}
                    onChange={(e) => patchLevel(i, { bucket: e.target.value as RatingBucket })}
                    className="h-8 pl-6 pr-6 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-semibold text-ih-fg-2 focus:shadow-ih-focus focus:border-ih-primary outline-none appearance-none"
                    title="Report bucket"
                  >
                    {BUCKETS.map((b) => (
                      <option key={b.value} value={b.value}>{b.label}</option>
                    ))}
                  </select>
                </div>

                {/* Reorder + remove */}
                <div className="flex items-center shrink-0">
                  <button type="button" onClick={() => moveLevel(i, -1)} disabled={i === 0} className="w-6 h-7 text-ih-fg-4 hover:text-ih-fg-1 disabled:opacity-30 disabled:hover:text-ih-fg-4" title="Move up">↑</button>
                  <button type="button" onClick={() => moveLevel(i, 1)} disabled={i === levels.length - 1} className="w-6 h-7 text-ih-fg-4 hover:text-ih-fg-1 disabled:opacity-30 disabled:hover:text-ih-fg-4" title="Move down">↓</button>
                  <button type="button" onClick={() => setLevels((prev) => prev.filter((_, j) => j !== i))} disabled={levels.length <= 2} className="w-6 h-7 text-ih-fg-4 hover:text-ih-bad-fg disabled:opacity-30 disabled:hover:text-ih-fg-4" title="Remove level">✕</button>
                </div>
              </div>
            ))}
          </div>

          {levels.length < 10 && (
            <button
              type="button"
              onClick={() => setLevels((prev) => [...prev, blankLevel()])}
              className="mt-2 w-full h-8 rounded-lg border border-dashed border-ih-border text-[12px] font-bold text-ih-fg-3 hover:text-ih-primary hover:border-ih-primary transition-colors"
            >
              + Add level
            </button>
          )}
        </div>

        {/* Default toggle */}
        <label className="flex items-center gap-2 text-[13px] text-ih-fg-2 select-none cursor-pointer">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="h-4 w-4 rounded border-ih-border text-ih-primary focus:ring-ih-primary/30" />
          Use as the default rating system for new templates
        </label>

        {error && (
          <div className="px-3 py-2 rounded-lg bg-ih-bad-bg border border-ih-bad text-[12px] text-ih-bad-fg">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
