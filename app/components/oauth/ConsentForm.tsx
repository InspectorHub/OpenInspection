import { useState } from "react";
import { m } from "~/paraglide/messages";
import type { ModuleGroup } from "../../../server/lib/mcp/tag-catalog";

/**
 * The OAuth consent screen, lifted out of `routes/oauth/authorize.tsx`.
 *
 * It moved for one reason and it is worth stating: the route module holds the
 * loader, the action, the redirect-URI validation and now the grant audit
 * write, and it had reached the file-size cap with the UI still inside it. The
 * route keeps the decisions; this file keeps the markup. `ConsentForm` is
 * re-exported from the route so the spec that renders it standalone, and any
 * other reader, still finds it where it always was.
 */

export interface ConsentFormProps {
  clientName: string;
  role: string;
  modules: ModuleGroup[];
  canWrite: boolean;
  oauthReqJson: string;
  submitting?: boolean;
}

/**
 * The modules x Read/Write consent grid. A native <form method="post"> (no
 * react-router <Form>) so the page works without JS and renders standalone in
 * unit tests. Checkboxes are controlled; ticking Write auto-ticks Read.
 */
export function ConsentForm({
  clientName,
  modules,
  canWrite,
  oauthReqJson,
  submitting = false,
}: ConsentFormProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const setRead = (key: string, v: boolean) =>
    setChecked((c) => {
      const next = { ...c, [`read:${key}`]: v };
      // Unticking Read also unticks Write (write implies read).
      if (!v) next[`write:${key}`] = false;
      return next;
    });
  const setWrite = (key: string, v: boolean) =>
    setChecked((c) => ({
      ...c,
      [`write:${key}`]: v,
      // Ticking Write implies Read.
      ...(v ? { [`read:${key}`]: true } : {}),
    }));

  const selectAllRead = () =>
    setChecked((c) => {
      const next = { ...c };
      for (const g of modules) next[`read:${g.key}`] = true;
      return next;
    });
  const clearAll = () => setChecked({});

  return (
    <div className="min-h-screen flex items-center justify-center bg-ih-bg-app px-4">
      <div className="w-full max-w-lg p-8">
        <div className="flex items-center gap-3 mb-6">
          <img src="/logo.svg" alt="" className="w-8 h-8" width={32} height={32} />
          <span className="text-lg font-bold text-ih-fg-1">OpenInspection</span>
        </div>

        <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">
          {m.oauth_authorize_heading()}
        </h1>
        <p className="text-sm text-ih-fg-3 mb-6">
          <span className="font-semibold text-ih-fg-1">{clientName}</span> {m.oauth_authorize_intro()}
        </p>

        <form method="post" className="space-y-5">
          <input type="hidden" name="oauthReq" value={oauthReqJson} />

          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-ih-fg-3">
              {m.oauth_authorize_modules()}
            </span>
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={selectAllRead}
                className="font-semibold text-ih-primary-text hover:underline"
              >
                {m.oauth_authorize_select_all_read()}
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="font-semibold text-ih-fg-3 hover:underline"
              >
                {m.oauth_authorize_none()}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-ih-border bg-ih-bg-card divide-y divide-ih-border">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ih-fg-3">
              <span>{m.oauth_authorize_col_module()}</span>
              <span className="text-center w-12">{m.oauth_authorize_col_read()}</span>
              {canWrite && <span className="text-center w-12">{m.oauth_authorize_col_write()}</span>}
            </div>
            {modules.map((g) => (
              <div
                key={g.key}
                data-testid={`module-${g.key}`}
                className="grid grid-cols-[1fr_auto_auto] gap-x-6 items-center px-4 py-3"
              >
                <span className="text-sm font-medium text-ih-fg-1">{g.label}</span>
                <label className="flex justify-center w-12 cursor-pointer">
                  <input
                    type="checkbox"
                    name={`read:${g.key}`}
                    value="1"
                    checked={!!checked[`read:${g.key}`]}
                    onChange={(e) => setRead(g.key, e.target.checked)}
                    className="h-4 w-4 rounded border-ih-border text-ih-primary focus:ring-ih-primary"
                    aria-label={m.oauth_authorize_aria_read({ module: g.label })}
                  />
                </label>
                {canWrite && (
                  <label className="flex justify-center w-12 cursor-pointer">
                    <input
                      type="checkbox"
                      name={`write:${g.key}`}
                      value="1"
                      checked={!!checked[`write:${g.key}`]}
                      onChange={(e) => setWrite(g.key, e.target.checked)}
                      className="h-4 w-4 rounded border-ih-border text-ih-primary focus:ring-ih-primary"
                      aria-label={m.oauth_authorize_aria_write({ module: g.label })}
                    />
                  </label>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-ih-fg-3">
            {m.oauth_authorize_scope_note({ clientName })}
          </p>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              name="cancel"
              value="1"
              className="flex-1 py-2.5 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 font-bold text-sm hover:bg-ih-bg-app transition-colors"
            >
              {m.common_cancel()}
            </button>
            <button
              type="submit"
              data-testid="oauth-authorize-submit"
              disabled={submitting}
              className="flex-1 py-2.5 rounded-lg bg-ih-primary text-ih-fg-inverse font-bold text-sm hover:bg-ih-primary-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? m.oauth_authorize_submit_pending() : m.oauth_authorize_submit()}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
