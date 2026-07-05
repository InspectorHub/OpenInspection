import { useState } from "react";
import { Form } from "react-router";

interface VideoIntegrationPanelProps {
  videoMode: "r2" | "stream";
  streamCustomerSubdomain: string;
  saving: boolean;
  serverError: string | null | undefined;
  serverField: string | null;
}

export function VideoIntegrationPanel({
  videoMode,
  streamCustomerSubdomain,
  saving,
  serverError,
  serverField,
}: VideoIntegrationPanelProps) {
  const [useStream, setUseStream] = useState(videoMode === "stream");
  const [subdomain, setSubdomain] = useState(streamCustomerSubdomain);
  const [subdomainError, setSubdomainError] = useState<string | undefined>(
    serverField === "streamCustomerSubdomain" ? serverError ?? undefined : undefined,
  );
  const [submittedOnce, setSubmittedOnce] = useState(false);

  function validateSubdomain(value: string): string | undefined {
    if (!useStream) return undefined;
    if (!value.trim()) return "Stream customer subdomain is required when Stream mode is enabled.";
    const hostnameRe =
      /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!hostnameRe.test(value.trim()))
      return "Must be a valid hostname (e.g. customer.cloudflarestream.com).";
    return undefined;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    setSubmittedOnce(true);
    if (useStream) {
      const err = validateSubdomain(subdomain);
      setSubdomainError(err);
      if (err) e.preventDefault();
    }
  }

  function handleSubdomainChange(value: string) {
    setSubdomain(value);
    if (submittedOnce) setSubdomainError(validateSubdomain(value));
  }

  function handleToggle(checked: boolean) {
    setUseStream(checked);
    if (submittedOnce && checked) {
      setSubdomainError(validateSubdomain(subdomain));
    } else {
      setSubdomainError(undefined);
    }
  }

  return (
    <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-md bg-ih-bg-muted border border-ih-border flex items-center justify-center">
          <svg
            className="w-4 h-4 text-ih-fg-2"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 10l4.553-2.069A1 1 0 0121 8.869v6.262a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
          </svg>
        </div>
        <div>
          <h3 className="text-[13px] font-bold text-ih-fg-1">Video</h3>
          <p className="text-[11px] text-ih-fg-3">
            Choose the video storage backend for this instance.
          </p>
        </div>
      </div>

      {/* Info callout */}
      <div className="rounded-md bg-ih-bg-muted border border-ih-border px-4 py-3 text-[12px] text-ih-fg-3 leading-relaxed">
        <span className="font-semibold text-ih-fg-2">Default: R2 (free).</span> Videos are stored
        in your Cloudflare R2 bucket — no extra cost beyond R2 storage rates.{" "}
        <span className="font-semibold text-ih-fg-2">Cloudflare Stream</span> enables adaptive
        bitrate playback and requires a paid Stream subscription plus the{" "}
        <span className="font-mono">STREAM</span> binding in your{" "}
        <span className="font-mono">wrangler</span> config.
      </div>

      {/* Server-level error (not field-specific) */}
      {serverError && !serverField && (
        <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
          {serverError}
        </div>
      )}

      <Form method="post" className="space-y-4" onSubmit={handleSubmit}>
        <input type="hidden" name="intent" value="save-video" />

        {/* Stream toggle */}
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div className="relative inline-flex">
            <input
              type="checkbox"
              name="useStream"
              className="sr-only peer"
              checked={useStream}
              onChange={(e) => handleToggle(e.target.checked)}
            />
            <div className="w-10 h-6 rounded-full bg-ih-bg-muted border border-ih-border transition-colors peer-checked:bg-ih-primary peer-checked:border-ih-primary" />
            <div className="absolute top-1 left-1 w-4 h-4 rounded-full bg-ih-bg-card shadow transition-transform peer-checked:translate-x-4" />
          </div>
          <span className="text-[13px] font-medium text-ih-fg-1">
            Use Cloudflare Stream for video{" "}
            <span className="text-[11px] font-normal text-ih-fg-3">(paid)</span>
          </span>
        </label>
        {/* Hidden videoMode value derived from toggle */}
        <input type="hidden" name="videoMode" value={useStream ? "stream" : "r2"} />

        {/* Stream customer subdomain — shown only when Stream is ON */}
        {useStream && (
          /* ds-allow: indent aligns the field under the toggle label (52px), bespoke offset with no spacing token */
          <div className="space-y-1.5 pl-[52px]">
            <label htmlFor="streamCustomerSubdomain" className="block text-[12px] font-bold text-ih-fg-2">
              Stream customer subdomain
            </label>
            <input
              id="streamCustomerSubdomain"
              name="streamCustomerSubdomain"
              type="text"
              value={subdomain}
              onChange={(e) => handleSubdomainChange(e.target.value)}
              placeholder="customer.cloudflarestream.com"
              className={[
                "w-full max-w-sm h-9 px-3 rounded-md border text-[13px] font-mono bg-ih-bg-input text-ih-fg-1 placeholder:text-ih-fg-4 outline-none transition-colors",
                subdomainError
                  ? "border-ih-bad focus:ring-1 focus:ring-ih-bad"
                  : "border-ih-border focus:border-ih-primary focus:ring-1 focus:ring-ih-primary",
              ].join(" ")}
              aria-describedby={subdomainError ? "subdomain-error" : "subdomain-hint"}
            />
            {subdomainError ? (
              <p id="subdomain-error" className="text-[11px] text-ih-bad-fg" role="alert">
                {subdomainError}
              </p>
            ) : (
              <p id="subdomain-hint" className="text-[11px] text-ih-fg-3">
                Found in your Cloudflare Stream dashboard under{" "}
                <span className="font-semibold text-ih-fg-2">Account → Customer subdomain</span>.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-ih-border">
          <button
            type="submit"
            disabled={saving}
            className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save video settings"}
          </button>
        </div>
      </Form>
    </section>
  );
}
