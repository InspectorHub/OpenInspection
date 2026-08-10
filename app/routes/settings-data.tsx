import { useLoaderData } from "react-router";
import { Banner, Button } from "@core/shared-ui";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-data";
import { requireAdminLoader } from "~/lib/access.server";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { AccessDenied } from "~/components/AccessDenied";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.settings_data_meta_title() }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden } = await requireAdminLoader(context, request);
  return { forbidden };
}

/** The install-what's-new section's submit. Owner-only is enforced server-side. */
export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const res = await api.admin.data["install-bundled-content"].$post();
    if (!res.ok) return { ok: false as const };
    const body = (await res.json()) as { data?: Record<string, number> };
    // One number, not ten: the operator's question is "did anything arrive?".
    // Zero is a real answer and the copy says so rather than looking inert.
    const added = Object.values(body.data ?? {}).reduce((sum, n) => sum + n, 0);
    return { ok: true as const, added };
  } catch {
    return { ok: false as const };
  }
}

export default function SettingsData() {
  const { forbidden } = useLoaderData<typeof loader>();
  const install = useGuardedSubmit<{ ok: boolean; added?: number }>();
  const installResult = install.fetcher.data;
  if (forbidden) return <AccessDenied />;
  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: m.settings_crumb_settings(), href: "/settings" }, { label: m.settings_data_crumb() }]} />
      <p className="text-[13px] text-ih-fg-3">
        {m.settings_data_subtitle()}
      </p>

      {/* Export section */}
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">{m.settings_data_export_heading()}</h3>
          <p className="text-[12px] text-ih-fg-3 mt-1">{m.settings_data_export_subtitle()}</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <a
            href="/api/admin/export?format=csv&type=inspections"
            className="h-9 px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 transition-colors inline-flex items-center gap-2"
          >
            <DownloadIcon />
            {m.settings_data_export_inspections_csv()}
          </a>
          <a
            href="/api/admin/export?format=csv&type=contacts"
            className="h-9 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors inline-flex items-center gap-2"
          >
            <DownloadIcon />
            {m.settings_data_export_contacts_csv()}
          </a>
          <a
            href="/api/admin/export?format=json"
            className="h-9 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors inline-flex items-center gap-2"
          >
            <DownloadIcon />
            {m.settings_data_export_full_json()}
          </a>
        </div>
      </section>

      {/* Import section */}
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">{m.settings_data_import_heading()}</h3>
          <p className="text-[12px] text-ih-fg-3 mt-1">
            {m.settings_data_import_subtitle()}
          </p>
        </div>
        <label className="block cursor-pointer">
          <div className="inline-flex items-center gap-3">
            <span className="h-9 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors inline-flex items-center gap-2">
              <UploadIcon />
              {m.settings_data_import_choose_file()}
            </span>
            <span className="text-[11px] text-ih-fg-3">{m.settings_data_import_file_hint()}</span>
          </div>
          <input type="file" accept=".csv,text/csv" className="hidden" />
        </label>
      </section>

      {/* Data cleanup */}
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">{m.settings_data_cleanup_heading()}</h3>
          <p className="text-[12px] text-ih-fg-3 mt-1">{m.settings_data_cleanup_subtitle()}</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button className="h-9 px-4 rounded-md border border-ih-bad text-[13px] font-medium text-ih-bad-fg hover:bg-ih-bad-bg transition-colors">
            {m.settings_data_cleanup_delete_test()}
          </button>
          <button className="h-9 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors">
            {m.settings_data_cleanup_gdpr_export()}
          </button>
        </div>
      </section>

      {/* Install what's new — the bundled starter content this release ships.
          ADDS only; the rename caveat is stated ABOVE the button because an
          operator would otherwise discover it by pressing the button. */}
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">{m.settings_data_bundled_heading()}</h3>
          <p className="text-[12px] text-ih-fg-3 mt-1">{m.settings_data_bundled_subtitle()}</p>
          <p className="text-[12px] text-ih-fg-3 mt-1">{m.settings_data_bundled_rename_note()}</p>
        </div>
        {installResult && (
          <Banner tone={!installResult.ok ? "danger" : installResult.added ? "success" : "info"}>
            {!installResult.ok
              ? m.settings_data_bundled_result_error()
              : installResult.added
                ? m.settings_data_bundled_result_added({ count: installResult.added })
                : m.settings_data_bundled_result_none()}
          </Banner>
        )}
        <Button
          variant="secondary"
          disabled={install.busy}
          onClick={() => install.submit({ intent: "install-bundled-content" }, { method: "post" })}
        >
          {install.busy ? m.settings_data_bundled_button_busy() : m.settings_data_bundled_button()}
        </Button>
      </section>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  );
}
