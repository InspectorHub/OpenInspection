import { useState } from "react";
import { useFetcher } from "react-router";
import { SegmentedControl } from "@core/shared-ui";
import { useCopyClipboard } from "~/hooks/useCopyClipboard";
import { m } from "~/paraglide/messages";

export type LegalDocsInitial = {
  legalMode: "hosted" | "custom";
  customPrivacyUrl: string;
  customTermsUrl: string;
  privacyBody: string;
  termsBody: string;
  hostedPrivacyUrl: string | null;
  hostedTermsUrl: string | null;
  effectivePrivacyUrl: string | null;
  effectiveTermsUrl: string | null;
};

type LegalSaveResult = {
  ok: boolean;
  intent?: string;
  message?: string;
};

/** Settings → Compliance → Privacy & Terms (hosted vs custom TFV URLs). */
export function LegalDocsPanel({ initial }: { initial: LegalDocsInitial }) {
  const fetcher = useFetcher<LegalSaveResult>();
  const { copied, copy } = useCopyClipboard();
  const [mode, setMode] = useState<"hosted" | "custom">(initial.legalMode);
  const [customPrivacyUrl, setCustomPrivacyUrl] = useState(initial.customPrivacyUrl);
  const [customTermsUrl, setCustomTermsUrl] = useState(initial.customTermsUrl);
  const [privacyBody, setPrivacyBody] = useState(initial.privacyBody);
  const [termsBody, setTermsBody] = useState(initial.termsBody);
  const [dirty, setDirty] = useState(false);

  const saving = fetcher.state !== "idle";
  const saved =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "legal-save" &&
    fetcher.data.ok === true &&
    !dirty;
  const failed =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "legal-save" &&
    fetcher.data.ok === false &&
    !dirty;

  function markDirty() {
    setDirty(true);
  }

  function handleSave() {
    setDirty(false);
    fetcher.submit(
      {
        intent: "legal-save",
        legalMode: mode,
        customPrivacyUrl,
        customTermsUrl,
        privacyBody,
        termsBody,
      },
      { method: "post" },
    );
  }

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <div>
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
          {m.settings_compliance_legal_heading()}
        </h3>
        <p className="text-[12px] text-ih-fg-3 mt-1">
          {m.settings_compliance_legal_desc()}
        </p>
      </div>

      <SegmentedControl
        size="md"
        ariaLabel={m.settings_compliance_legal_heading()}
        value={mode}
        onChange={(next) => {
          setMode(next === "custom" ? "custom" : "hosted");
          markDirty();
        }}
        options={[
          { value: "hosted", label: m.settings_compliance_legal_mode_hosted() },
          { value: "custom", label: m.settings_compliance_legal_mode_custom() },
        ]}
      />

      {mode === "hosted" ? (
        <div className="space-y-3">
          <p className="text-[12px] text-ih-fg-3">{m.settings_compliance_legal_hosted_note()}</p>
          <UrlCopyRow
            label={m.settings_compliance_legal_privacy_url()}
            url={initial.hostedPrivacyUrl}
            copied={copied === "privacy"}
            onCopy={() => {
              if (initial.hostedPrivacyUrl) copy(initial.hostedPrivacyUrl, "privacy");
            }}
          />
          <UrlCopyRow
            label={m.settings_compliance_legal_terms_url()}
            url={initial.hostedTermsUrl}
            copied={copied === "terms"}
            onCopy={() => {
              if (initial.hostedTermsUrl) copy(initial.hostedTermsUrl, "terms");
            }}
          />
          <label className="block">
            <span className="block text-[12px] font-bold text-ih-fg-2 mb-1">
              {m.settings_compliance_legal_privacy_body()}
            </span>
            <textarea
              value={privacyBody}
              onChange={(e) => {
                setPrivacyBody(e.target.value);
                markDirty();
              }}
              rows={6}
              placeholder={m.settings_compliance_legal_body_placeholder()}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-[12px] font-bold text-ih-fg-2 mb-1">
              {m.settings_compliance_legal_terms_body()}
            </span>
            <textarea
              value={termsBody}
              onChange={(e) => {
                setTermsBody(e.target.value);
                markDirty();
              }}
              rows={6}
              placeholder={m.settings_compliance_legal_body_placeholder()}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            />
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[12px] text-ih-fg-3">{m.settings_compliance_legal_custom_note()}</p>
          <label className="block">
            <span className="block text-[12px] font-bold text-ih-fg-2 mb-1">
              {m.settings_compliance_legal_privacy_url()}
            </span>
            <input
              type="url"
              value={customPrivacyUrl}
              onChange={(e) => {
                setCustomPrivacyUrl(e.target.value);
                markDirty();
              }}
              placeholder="https://"
              className="w-full px-3 py-1.5 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-[12px] font-bold text-ih-fg-2 mb-1">
              {m.settings_compliance_legal_terms_url()}
            </span>
            <input
              type="url"
              value={customTermsUrl}
              onChange={(e) => {
                setCustomTermsUrl(e.target.value);
                markDirty();
              }}
              placeholder="https://"
              className="w-full px-3 py-1.5 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            />
          </label>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="h-9 px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
        >
          {saving ? m.settings_compliance_saving() : m.common_save()}
        </button>
        {dirty && !saving && (
          <span className="text-[13px] text-ih-fg-3 font-medium">{m.settings_compliance_legal_unsaved()}</span>
        )}
        {saved && <span className="text-[13px] text-ih-ok-fg font-bold">{m.settings_flash_saved_short()}</span>}
        {failed && (
          <span className="text-[13px] text-ih-bad-fg font-bold">
            {fetcher.data?.message ?? m.settings_compliance_save_failed()}
          </span>
        )}
      </div>
    </section>
  );
}

function UrlCopyRow({
  label,
  url,
  copied,
  onCopy,
}: {
  label: string;
  url: string | null;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-md border border-ih-border bg-ih-bg-muted px-3 py-2 space-y-1">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ih-fg-3">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-[12px] text-ih-fg-2 break-all font-mono">{url ?? "—"}</code>
        {url && (
          <>
            <button
              type="button"
              onClick={onCopy}
              className="h-8 px-3 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[12px] hover:bg-ih-primary-600 transition-colors shrink-0"
            >
              {copied ? m.settings_common_copied() : m.settings_compliance_legal_copy()}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ih-fg-3 hover:text-ih-primary transition-colors shrink-0"
              aria-label={m.settings_compliance_legal_open()}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"
                />
              </svg>
            </a>
          </>
        )}
      </div>
    </div>
  );
}
