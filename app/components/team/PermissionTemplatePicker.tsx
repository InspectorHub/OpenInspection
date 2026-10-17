import { m } from "~/paraglide/messages";
import { templateBeyondActor, templateDescription, templateName, type TemplateActor, type TemplateOption } from "./permission-template-ui";
import type { PermissionOverrides } from "../../../server/lib/auth/capabilities";
import type { TemplateRole } from "../../../server/lib/auth/permission-templates";

interface Props {
  templates: readonly TemplateOption[];
  /** Id of the chosen template, or "" for none. */
  value: string;
  /** The form no longer shows exactly what the chosen template gives. */
  customized: boolean;
  onChange: (id: string) => void;
  actor: TemplateActor | null;
  /** What the person holds today (edit), or null (invite): keeping something they have is never a grant. */
  from: { role: TemplateRole; overrides: PermissionOverrides | null } | null;
}

/**
 * "Start from a template" for the invite and edit drawers. Choosing one fills the
 * role and the permission switches below; they stay editable, and an edit turns the
 * label to "Customized". Renders nothing when there are no templates to offer, so a
 * deployment whose template list failed to load shows the plain form.
 *
 * A template the actor could not hand out (it turns on something they lack) is
 * shown but disabled, with the reason, rather than hidden: a missing option reads
 * as a bug, a disabled one reads as a rule.
 */
export function PermissionTemplatePicker({ templates, value, customized, onChange, actor, from }: Props) {
  if (templates.length === 0) return null;
  const builtIn = templates.filter((t) => t.system);
  const own = templates.filter((t) => !t.system);
  const chosen = templates.find((t) => t.id === value);
  const option = (t: TemplateOption) => {
    const beyond = templateBeyondActor(actor, t, from);
    return (
      <option key={t.id} value={t.id} disabled={beyond && t.id !== value} title={beyond ? m.modal_invite_cap_owner_only() : undefined}>
        {templateName(t)}
      </option>
    );
  };
  const description = chosen ? templateDescription(chosen) : null;
  return (
    <div className="space-y-1">
      <label className="block">
        <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">
          {m.team_template_picker_label()}
          {customized && (
            <span className="rounded-full bg-ih-bg-muted px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-ih-fg-2">
              {m.team_template_customized()}
            </span>
          )}
        </span>
        <select
          className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{m.team_template_picker_none()}</option>
          {builtIn.length > 0 && <optgroup label={m.team_template_group_builtin()}>{builtIn.map(option)}</optgroup>}
          {own.length > 0 && <optgroup label={m.team_template_group_company()}>{own.map(option)}</optgroup>}
        </select>
      </label>
      <p className="text-xs text-ih-fg-3">{description ?? m.team_template_hint()}</p>
    </div>
  );
}
