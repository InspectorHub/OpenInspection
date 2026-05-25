import { Link } from "react-router";

export function meta() {
  return [{ title: "Data - Settings - OpenInspection" }];
}

export default function SettingsData() {
  return (
    <div className="space-y-[18px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <Link to="/settings" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-slate-900 dark:text-slate-100">Data</span>
      </div>

      <h2 className="text-[19px] font-bold text-slate-900 dark:text-slate-100">Data import / export</h2>
      <p className="text-[13px] text-slate-500 dark:text-slate-400">
        Download your data or import contacts from other platforms.
      </p>

      {/* Export section */}
      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">Export</h3>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1">Download your data as CSV or JSON. All historical records are included.</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <a
            href="/api/admin/export?format=csv&type=inspections"
            className="h-9 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 transition-colors inline-flex items-center gap-2"
          >
            <DownloadIcon />
            Inspections CSV
          </a>
          <a
            href="/api/admin/export?format=csv&type=contacts"
            className="h-9 px-4 rounded-md border border-slate-200 dark:border-slate-600 text-[13px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors inline-flex items-center gap-2"
          >
            <DownloadIcon />
            Contacts CSV
          </a>
          <a
            href="/api/admin/export?format=json"
            className="h-9 px-4 rounded-md border border-slate-200 dark:border-slate-600 text-[13px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors inline-flex items-center gap-2"
          >
            <DownloadIcon />
            Full JSON
          </a>
        </div>
      </section>

      {/* Import section */}
      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">Import contacts</h3>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1">
            Supports Spectora and Inspector Toolbelt export formats. Duplicates (same email) are skipped.
          </p>
        </div>
        <label className="block cursor-pointer">
          <div className="inline-flex items-center gap-3">
            <span className="h-9 px-4 rounded-md border border-slate-200 dark:border-slate-600 text-[13px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors inline-flex items-center gap-2">
              <UploadIcon />
              Choose CSV file
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">Max 5 MB, UTF-8 encoded</span>
          </div>
          <input type="file" accept=".csv,text/csv" className="hidden" />
        </label>
      </section>

      {/* Data cleanup */}
      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">Data cleanup</h3>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1">Remove test data or request a full GDPR data export.</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button className="h-9 px-4 rounded-md border border-rose-200 dark:border-rose-800 text-[13px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors">
            Delete test data
          </button>
          <button className="h-9 px-4 rounded-md border border-slate-200 dark:border-slate-600 text-[13px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            Request GDPR export
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
