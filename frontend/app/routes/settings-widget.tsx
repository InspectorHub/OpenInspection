import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/settings-widget";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Embed Widget - Settings - OpenInspection" }];
}

interface WidgetConfig {
  origins: string[];
  style: "light" | "dark" | "branded";
  snippetUrl: string | null;
  previewUrl: string | null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/widget", { token });
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    const d = (body.data ?? {}) as Record<string, unknown> | undefined;
    return {
      config: {
        origins: (d?.origins || []) as string[],
        style: (d?.style as string) || "light",
        snippetUrl: (d?.snippetUrl as string) || null,
        previewUrl: (d?.previewUrl as string) || null,
      } as WidgetConfig,
    };
  } catch {
    return {
      config: { origins: [], style: "light", snippetUrl: null, previewUrl: null } as WidgetConfig,
    };
  }
}

const STYLES = [
  { id: "light", label: "Light", icon: "sun" },
  { id: "dark", label: "Dark", icon: "moon" },
  { id: "branded", label: "Branded", icon: "palette" },
] as const;

export default function SettingsWidget() {
  const { config } = useLoaderData<typeof loader>();
  const [style, setStyle] = useState(config.style);
  const [copied, setCopied] = useState(false);

  const snippet = config.snippetUrl
    ? `<iframe src="${config.snippetUrl}?style=${style}" style="width:100%;min-height:700px;border:none;" loading="lazy"></iframe>`
    : `<!-- Widget snippet will appear once your booking page is configured -->`;

  function copySnippet() {
    void navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-[18px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link to="/settings" className="hover:text-ih-primary transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">Embed widget</span>
      </div>

      <h2 className="text-[19px] font-bold text-ih-fg-1">Embed booking widget</h2>
      <p className="text-[13px] text-ih-fg-3">
        Paste a snippet on your marketing site. Bookings flow into your inspections list.
      </p>

      {/* Style picker */}
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-3">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Widget style</h3>
        <div className="flex gap-2">
          {STYLES.map((s) => (
            <button
              key={s.id}
              onClick={() => setStyle(s.id)}
              className={`h-9 px-4 rounded-md border-2 text-[13px] font-bold transition-colors ${
 style === s.id
 ? "border-ih-primary text-ih-primary bg-ih-primary-tint"
 : "border-ih-border text-ih-fg-2 hover:border-ih-border"
 }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      {/* Embed code */}
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Embed code</h3>
          <button
            onClick={copySnippet}
            className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors"
          >
            {copied ? "Copied!" : "Copy snippet"}
          </button>
        </div>
        <pre className="bg-slate-900 text-emerald-300 dark:bg-slate-950 p-4 rounded-md overflow-x-auto text-[12px] font-mono leading-relaxed whitespace-pre-wrap break-all">
          {snippet}
        </pre>
      </section>

      {/* Preview */}
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-3">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Live preview</h3>
        {config.previewUrl ? (
          <iframe
            src={`${config.previewUrl}?style=${style}`}
            className="w-full min-h-[700px] rounded-md border border-ih-border"
            loading="lazy"
            title="Widget preview"
          />
        ) : (
          <div className="w-full min-h-[300px] rounded-md border-2 border-dashed border-ih-border flex items-center justify-center">
            <div className="text-center">
              <WidgetIcon />
              <p className="text-[13px] text-ih-fg-3 mt-2">Preview will appear once your booking page is set up.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function WidgetIcon() {
  return (
    <svg className="w-8 h-8 mx-auto text-ih-fg-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  );
}
