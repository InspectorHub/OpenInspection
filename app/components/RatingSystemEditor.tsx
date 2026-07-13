import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Modal, Button, IconButton, Icon } from "@core/shared-ui";
import type { Severity } from "~/lib/severity";
import { SEVERITIES, SEVERITY_LABEL, SEVERITY_DOT } from "~/lib/severity";

/* ------------------------------------------------------------------ */
/*  Types + presets (mirrors server CreateRatingSystemSchema)         */
/* ------------------------------------------------------------------ */

export interface EditorLevel {
  id?: string;
  abbreviation: string;
  label: string;
  color: string;
  severity: Severity;
  isDefect: boolean;
  pausesAdvance?: boolean;
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

const PRESETS: { name: string; levels: EditorLevel[] }[] = [
  { name: "3-level", levels: [
    { abbreviation: "S", label: "Satisfactory", color: "#22c55e", severity: "good", isDefect: false, hotkey: "1" },
    { abbreviation: "M", label: "Monitor", color: "#f59e0b", severity: "marginal", isDefect: false, hotkey: "2" },
    { abbreviation: "D", label: "Defect", color: "#ef4444", severity: "significant", isDefect: true, pausesAdvance: true, hotkey: "3" },
  ] },
  { name: "5-level", levels: [
    { abbreviation: "Sat", label: "Satisfactory", color: "#22c55e", severity: "good", isDefect: false, hotkey: "1" },
    { abbreviation: "Mon", label: "Monitor", color: "#f59e0b", severity: "marginal", isDefect: false, hotkey: "2" },
    { abbreviation: "Def", label: "Defect", color: "#ef4444", severity: "significant", isDefect: true, pausesAdvance: true, hotkey: "3" },
    { abbreviation: "NI", label: "Not Inspected", color: "#9ca3af", severity: "minor", isDefect: false, hotkey: "4" },
    { abbreviation: "NP", label: "Not Present", color: "#6b7280", severity: "minor", isDefect: false, hotkey: "5" },
  ] },
  { name: "TREC", levels: [
    { abbreviation: "I", label: "Inspected", color: "#22c55e", severity: "good", isDefect: false, hotkey: "1" },
    { abbreviation: "D", label: "Deficient", color: "#ef4444", severity: "significant", isDefect: true, pausesAdvance: true, hotkey: "2" },
    { abbreviation: "NI", label: "Not Inspected", color: "#9ca3af", severity: "minor", isDefect: false, hotkey: "3" },
    { abbreviation: "NP", label: "Not Present", color: "#6b7280", severity: "minor", isDefect: false, hotkey: "4" },
  ] },
];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

const blankLevel = (): EditorLevel => ({ abbreviation: "", label: "", color: "#64748b", severity: "good", isDefect: false });

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function RatingSystemEditor({
  open,
  onClose,
  system,
  onSaveLevels,
}: {
  open: boolean;
  onClose: () => void;
  system?: EditorSystem | null;
  /** When provided, the editor persists levels via this callback (template schema)
   *  instead of POSTing to /library/rating-systems (the default library-table save). */
  onSaveLevels?: (levels: EditorLevel[]) => void;
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
    : levels.some((l) => !l.abbreviation.trim() || !l.label.trim()) ? "Every level needs an abbreviation and a label"
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
    if (onSaveLevels) {
      onSaveLevels(levels.map((l) => ({ ...l })));
      onClose();
      return;
    }
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
            abbreviation: l.abbreviation.trim(),
            label: l.label.trim(),
            color: l.color,
            severity: l.severity,
            isDefect: l.isDefect,
            ...(l.pausesAdvance ? { pausesAdvance: true } : {}),
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
                <Button
                  key={p.name}
                  variant="secondary"
                  size="sm"
                  onClick={() => setLevels(p.levels.map((l) => ({ ...l })))}
                  className="h-6 px-2 text-[11px] text-ih-primary hover:bg-ih-primary-tint"
                >
                  {p.name}
                </Button>
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
                  {lvl.abbreviation.slice(0, 3) || "·"}
                  <input
                    type="color"
                    value={lvl.color}
                    onChange={(e) => patchLevel(i, { color: e.target.value })}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    aria-label="Level color"
                  />
                </label>

                <input
                  value={lvl.abbreviation}
                  onChange={(e) => patchLevel(i, { abbreviation: e.target.value })}
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

                {/* Severity — the single rating-axis classification (spec §4.F) */}
                <div className="relative shrink-0">
                  <span
                    className={`absolute left-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full pointer-events-none ${SEVERITY_DOT[lvl.severity]}`}
                  />
                  <select
                    value={lvl.severity}
                    onChange={(e) => patchLevel(i, { severity: e.target.value as Severity })}
                    className="h-8 pl-6 pr-6 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-semibold text-ih-fg-2 focus:shadow-ih-focus focus:border-ih-primary outline-none appearance-none"
                    title="Severity"
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-1 text-[10px] text-ih-fg-3 shrink-0" title="Counts as a defect in rollups">
                  <input type="checkbox" checked={lvl.isDefect} onChange={(e) => patchLevel(i, { isDefect: e.target.checked })} className="accent-ih-bad-fg" />
                  Defect
                </label>
                <label className="flex items-center gap-1 text-[10px] text-ih-fg-3 shrink-0" title="Pause auto-advance after selecting this level">
                  <input type="checkbox" checked={!!lvl.pausesAdvance} onChange={(e) => patchLevel(i, { pausesAdvance: e.target.checked })} className="accent-ih-primary" />
                  Pause
                </label>

                {/* Reorder + remove */}
                <div className="flex items-center shrink-0">
                  <IconButton
                    aria-label="Move up"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveLevel(i, -1)}
                    disabled={i === 0}
                    title="Move up"
                    className="w-6 text-ih-fg-4 hover:text-ih-fg-1"
                  >
                    <Icon name="chevU" size={14} />
                  </IconButton>
                  <IconButton
                    aria-label="Move down"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveLevel(i, 1)}
                    disabled={i === levels.length - 1}
                    title="Move down"
                    className="w-6 text-ih-fg-4 hover:text-ih-fg-1"
                  >
                    <Icon name="chevD" size={14} />
                  </IconButton>
                  <IconButton
                    aria-label="Remove level"
                    variant="ghost"
                    size="sm"
                    onClick={() => setLevels((prev) => prev.filter((_, j) => j !== i))}
                    disabled={levels.length <= 2}
                    title="Remove level"
                    className="w-6 text-ih-fg-4 hover:text-ih-bad-fg"
                  >
                    <Icon name="x" size={14} />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>

          {levels.length < 10 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setLevels((prev) => [...prev, blankLevel()])}
              className="mt-2 w-full h-8 rounded-lg border-dashed text-[12px] text-ih-fg-3 hover:text-ih-primary hover:border-ih-primary"
            >
              + Add level
            </Button>
          )}
        </div>

        {/* Default toggle — meaningless when persisting to a template's own schema */}
        {!onSaveLevels && (
          <label className="flex items-center gap-2 text-[13px] text-ih-fg-2 select-none cursor-pointer">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="h-4 w-4 rounded border-ih-border text-ih-primary focus:ring-ih-primary/30" />
            Use as the default rating system for new templates
          </label>
        )}

        {error && (
          <div className="px-3 py-2 rounded-lg bg-ih-bad-bg border border-ih-bad text-[12px] text-ih-bad-fg">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
