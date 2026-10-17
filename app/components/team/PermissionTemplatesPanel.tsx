import { useEffect, useState } from "react";
import { Card, Pill, PENDING_CLASS, pendingProps } from "@core/shared-ui";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { m } from "~/paraglide/messages";
import { MAX_TEMPLATE_NAME_LENGTH } from "../../../server/lib/auth/permission-templates";
import { ROLE_TONES } from "~/routes/team.shapes";
import { templateBadge, type TemplateOption } from "./permission-template-ui";

type Result = { ok: boolean; intent?: string | null; error: string | null };

/** The line under a member's role: the template they match, or "Custom". Nothing for an owner, an agent or a pending invite. */
export function TemplateBadge({ member, templates }: { member: { role: string; status: string; permissionOverrides: Record<string, boolean> | null }; templates: readonly TemplateOption[] }) {
  const label = templateBadge(member, templates);
  return label ? <p className="text-[11px] text-ih-fg-3 mt-0.5">{label}</p> : null;
}

/**
 * The company's own permission templates, with rename and archive. Creating one
 * happens where the permissions are set (the invite and edit drawers, "Save as
 * template"); this list is for keeping them tidy afterwards.
 *
 * Archiving hides a template from the pickers and frees its name; nobody who
 * received it changes, because applying a template copied it. Renaming sends the
 * template's role and switches along with the new name, since the API replaces the
 * whole template.
 */
export function PermissionTemplatesPanel({ templates }: { templates: readonly TemplateOption[] }) {
  const own = templates.filter((t) => !t.system);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [archiving, setArchiving] = useState<TemplateOption | null>(null);
  const [error, setError] = useState("");
  const { submit: guardedSubmit, fetcher, busy } = useGuardedSubmit<Result>();

  useEffect(() => {
    const d = fetcher.data;
    if (!d) return;
    if (d.ok) {
      setRenaming(null);
      setArchiving(null);
      setError("");
    } else {
      setError(d.error ?? m.team_template_save_failed());
    }
  }, [fetcher.data]);

  // Only shown when the template list loaded at all; a list that failed to load says nothing.
  if (templates.length === 0) return null;

  function submit(fields: Record<string, string>) {
    setError("");
    guardedSubmit(fields, { method: "POST", action: "/resources/team-members" });
  }

  function rename(t: TemplateOption, name: string) {
    const next = name.trim();
    if (!next || next === t.name) { setRenaming(null); return; }
    submit({ intent: "rename-template", id: t.id, name: next, baseRole: t.baseRole, overrides: JSON.stringify(t.overrides) });
  }

  return (
    <Card className="p-6 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-ih-fg-1">{m.settings_team_templates_heading()}</h2>
        <p className="text-xs text-ih-fg-3 mt-1">{m.settings_team_templates_help()}</p>
      </div>
      {own.length === 0 ? (
        <p className="text-sm text-ih-fg-3">{m.settings_team_templates_empty()}</p>
      ) : (
        <ul className="divide-y divide-ih-border">
          {own.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              {renaming?.id === t.id ? (
                <div className="flex flex-1 items-center gap-2">
                  <input
                    className="flex-1 px-3 py-1.5 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1"
                    value={renaming.name}
                    maxLength={MAX_TEMPLATE_NAME_LENGTH}
                    aria-label={m.team_template_save_name_label()}
                    onChange={(e) => setRenaming({ id: t.id, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); rename(t, renaming.name); } }}
                  />
                  <button
                    type="button"
                    {...pendingProps(busy, () => rename(t, renaming.name))}
                    className={`text-[12px] font-medium text-ih-primary-text hover:underline ${PENDING_CLASS}`}
                  >
                    {m.common_save()}
                  </button>
                  <button type="button" onClick={() => { setRenaming(null); setError(""); }} className="text-[12px] font-medium text-ih-fg-3 hover:text-ih-fg-1">
                    {m.common_cancel()}
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] font-medium text-ih-fg-1 truncate">{t.name}</span>
                    <Pill tone={ROLE_TONES[t.baseRole] || "gen"}>{t.baseRole}</Pill>
                  </div>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setRenaming({ id: t.id, name: t.name })} className="text-[12px] font-medium text-ih-fg-3 hover:text-ih-fg-1">
                      {m.settings_team_templates_rename()}
                    </button>
                    <button type="button" onClick={() => setArchiving(t)} className="text-[12px] font-medium text-ih-bad-fg hover:underline">
                      {m.settings_team_templates_archive()}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-ih-bad-fg font-semibold">{error}</p>}
      <ConfirmDialog
        open={archiving !== null}
        title={m.settings_team_templates_archive_title()}
        message={archiving ? m.settings_team_templates_archive_confirm({ name: archiving.name }) : ""}
        confirmLabel={m.settings_team_templates_archive()}
        busy={busy}
        onConfirm={() => { if (archiving) submit({ intent: "archive-template", id: archiving.id }); }}
        onCancel={() => setArchiving(null)}
      />
    </Card>
  );
}
