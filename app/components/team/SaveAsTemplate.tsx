import { useEffect, useState } from "react";
import { PENDING_CLASS, pendingProps } from "@core/shared-ui";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { isTemplateRole, MAX_TEMPLATE_NAME_LENGTH } from "../../../server/lib/auth/permission-templates";
import type { PermissionOverrides } from "../../../server/lib/auth/capabilities";
import { m } from "~/paraglide/messages";

interface Props {
  /** The role in the form. Only manager, inspector and staff can be a template's base role. */
  role: string;
  /** The switches that differ from that role's defaults, as the drawer would send them. */
  overrides: PermissionOverrides;
  /** Company templates already saved, so the limit can be said before a submit that would fail. */
  savedCount: number;
  maxTemplates: number;
}

/**
 * "Save as template" at the foot of the invite and edit drawers: keeps the role and
 * permissions on screen under a name, so the next person can start from them.
 *
 * It is a form of its own inside a drawer that already holds a form, so it submits
 * through a guarded fetcher from a button rather than nesting a <form>. The guard
 * decides before React has rendered any busy state, so two clicks in one frame send
 * once; the server also refuses a second live template of the same name.
 */
export function SaveAsTemplate({ role, overrides, savedCount, maxTemplates }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const { submit, fetcher, busy } = useGuardedSubmit<{ ok: boolean; intent?: string | null; error: string | null }>();

  useEffect(() => {
    const d = fetcher.data;
    if (!d || d.intent !== "create-template") return;
    if (d.ok) {
      setOpen(false);
      setName("");
      setError("");
    } else {
      setError(d.error ?? m.team_template_save_failed());
    }
  }, [fetcher.data]);

  if (!isTemplateRole(role)) return null;
  const atLimit = savedCount >= maxTemplates;

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError("");
    submit(
      { intent: "create-template", name: trimmed, baseRole: role, overrides: JSON.stringify(overrides) },
      { method: "POST", action: "/resources/team-members" },
    );
  }

  return (
    <div className="border-t border-ih-border pt-3 space-y-2">
      {!open ? (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={atLimit}
            className="text-[12px] font-medium text-ih-primary-text hover:underline disabled:opacity-50 disabled:no-underline"
          >
            {m.team_template_save_open()}
          </button>
          {atLimit && <p className="text-xs text-ih-fg-3">{m.settings_team_templates_limit({ max: maxTemplates })}</p>}
          {fetcher.data?.ok && fetcher.data.intent === "create-template" && <p className="text-xs text-ih-ok-fg">{m.team_template_save_done()}</p>}
        </>
      ) : (
        <div className="space-y-2">
          <label className="block">
            <span className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">{m.team_template_save_name_label()}</span>
            <input
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1"
              value={name}
              maxLength={MAX_TEMPLATE_NAME_LENGTH}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                // Enter must not submit the drawer's own form behind this field.
                if (e.key === "Enter") { e.preventDefault(); save(); }
              }}
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!name.trim()}
              {...pendingProps(busy, save)}
              className={`px-3 h-8 rounded-lg bg-ih-primary text-ih-fg-inverse text-xs font-semibold hover:bg-ih-primary-600 disabled:opacity-50 ${PENDING_CLASS}`}
            >
              {m.team_template_save_submit()}
            </button>
            <button type="button" onClick={() => { setOpen(false); setError(""); }} className="text-xs font-medium text-ih-fg-3 hover:text-ih-fg-1">
              {m.common_cancel()}
            </button>
          </div>
          {error && <p className="text-xs text-ih-bad-fg font-semibold">{error}</p>}
        </div>
      )}
    </div>
  );
}
