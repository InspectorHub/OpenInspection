import { useLoaderData } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-data";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.settings_data_meta_title() }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden } = await requireAdminLoader(context, request);
  return { forbidden };
}

export default function SettingsData() {
  const { forbidden } = useLoaderData<typeof loader>();
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
            className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors inline-flex items-center gap-2"
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
