import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import { LogoUploader } from "~/components/media-studio/LogoUploader";
import { m } from "~/paraglide/messages";

type LogoUploadResult = {
  success: boolean;
  intent?: string;
  logoUrl?: string | null;
  error?: string;
};

export interface LogoFieldProps {
  /** Stored logo URL from the branding record. The field owns it after an upload. */
  initialUrl: string | null;
}

/**
 * The company-logo field on Settings → Workspace: label, uploader, and — the part
 * that was missing — the failure message.
 *
 * A failed upload used to render NOTHING. The fetcher returned `{ success: false }`,
 * the button dropped back from "Uploading…" to "Upload", the preview stayed empty,
 * and a wrong file type, an oversized file and an unreachable bucket were
 * indistinguishable on screen. `CredentialsEditor` — the other consumer of
 * `LogoUploader` — has always rendered its errors; this is the same treatment.
 */
export function LogoField({ initialUrl }: LogoFieldProps) {
  const fetcher = useFetcher<LogoUploadResult>();
  const [logoUrl, setLogoUrl] = useState<string | null>(initialUrl);

  useEffect(() => {
    const d = fetcher.data;
    if (fetcher.state === "idle" && d?.intent === "logo-upload" && d.success && d.logoUrl) {
      setLogoUrl(d.logoUrl);
    }
  }, [fetcher.state, fetcher.data]);

  // Only while idle: mid-upload the previous attempt's error is stale, and showing
  // it under a spinner reads as the new attempt having already failed.
  const failed =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "logo-upload" &&
    fetcher.data.success === false
      ? fetcher.data.error
      : undefined;

  return (
    <div className="space-y-3">
      <label className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">
        {m.settings_workspace_logo_label()}
      </label>
      <LogoUploader
        currentUrl={logoUrl}
        uploading={fetcher.state !== "idle"}
        onSelect={(file) => {
          const fd = new FormData();
          fd.append("intent", "logo-upload");
          fd.append("logo", file);
          fetcher.submit(fd, { method: "POST", encType: "multipart/form-data" });
        }}
      />
      {failed ? (
        <p role="alert" className="text-[11px] text-ih-bad-fg leading-tight">{failed}</p>
      ) : null}
    </div>
  );
}
