import { useState } from "react";
import { useFetcher } from "react-router";
import { SignaturePad } from "~/components/SignaturePad";
import { useNotificationSaveToast } from "~/hooks/useNotificationSaveToast";
import { m } from "~/paraglide/messages";

/**
 * The two signature cards on Settings → Profile, lifted out of the route.
 *
 * They are here because each OWNS ITS OWN SAVE, which is the rule the Profile
 * page now keeps: a button means you must submit, and its absence means it is
 * already done. Holding that rule in the route meant the route also held two
 * fetchers, a toast, a pad's open/closed state and their markup, on top of the
 * one form it actually submits. Each card carrying its own is what makes the
 * rule legible instead of asserted.
 */

type SaveResult = { success?: boolean; error?: string; intent?: string };

/**
 * The email-signature footer: an opt-in toggle and a live preview.
 *
 * The toggle used to be a checkbox inside the profile form, saved by the page's
 * Save button along with name and phone — a control that looked self-contained
 * and was not. It saves itself now.
 */
export function EmailSignatureCard({
  enabled, previewHtml,
}: { enabled: boolean; previewHtml: string | null }) {
  const fetcher = useFetcher<SaveResult>();
  const failed = fetcher.data?.intent === "signature-toggle" && fetcher.data?.success === false;
  useNotificationSaveToast({
    data: fetcher.data?.intent === "signature-toggle" ? fetcher.data : null,
    failed,
    error: fetcher.data?.error ?? null,
  });

  return (
    <section id="signature" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4 scroll-mt-12">
      <header className="space-y-1">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_profile_signature_heading()}</h3>
        <p className="text-[12px] text-ih-fg-3">{m.settings_profile_signature_subtitle()}</p>
      </header>

      {/* Saves on change. There is no button here because there is nothing left
          to submit, and the toast is what makes that claim checkable. */}
      <label className="flex items-center gap-2 text-[13px] text-ih-fg-1">
        <input
          type="checkbox"
          defaultChecked={enabled}
          disabled={fetcher.state !== "idle"}
          onChange={(e) => fetcher.submit(
            { intent: "signature-toggle", signatureEnabled: String(e.currentTarget.checked) },
            { method: "post" },
          )}
        />
        {m.settings_profile_signature_toggle()}
      </label>

      {previewHtml ? (
        <div className="rounded-md border border-ih-border bg-ih-bg-muted p-4">
          <div className="text-[11px] text-ih-fg-3 mb-2 uppercase tracking-[0.2em]">{m.settings_profile_signature_preview_label()}</div>
          {/* THE PREVIEW IS DELIBERATELY LIGHT IN BOTH THEMES.
              `inspectorSignature()` bakes literal colours into the HTML
              (`#0f172a` text, `#e2e8f0` rule) and has to — a mail client has
              none of our tokens, and the footer must read correctly in an inbox.
              Dropped straight onto a themed card that HTML was near-black on
              near-black in dark mode: the one surface whose whole job is showing
              what the recipient sees, showing nothing. So the swatch carries the
              medium's background rather than the app's. */}
          <div
            // ds-allow: email body — the swatch renders mail-client HTML whose
            // colours are literal by necessity, so it carries the inbox's
            // background, not the app's theme.
            className="rounded bg-white px-3 py-2 overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      ) : (
        <p className="text-[12px] text-ih-fg-3">{m.settings_profile_signature_empty()}</p>
      )}
    </section>
  );
}

/**
 * The drawn signature used on reports and agreements.
 *
 * Its feedback stays INLINE rather than becoming a toast: the pad is a modal
 * act the reader is looking straight at when it resolves, so the confirmation
 * belongs where their attention already is. (The toast exists for the saves
 * that happen without ceremony — a blurred field, a flipped checkbox.)
 */
export function SavedSignatureCard() {
  const fetcher = useFetcher<SaveResult>();
  const [showPad, setShowPad] = useState(false);
  const isOurs = fetcher.data?.intent === "save-signature";
  const saved = isOurs && fetcher.data?.success === true;
  const error = isOurs && typeof fetcher.data?.error === "string" ? fetcher.data.error : null;

  return (
    <section id="saved-signature" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5 scroll-mt-12">
      <header className="space-y-1">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_profile_saved_signature_heading()}</h3>
        <p className="text-[12px] text-ih-fg-3">{m.settings_profile_saved_signature_subtitle()}</p>
      </header>

      {saved && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          {m.settings_profile_signature_saved_flash()}
        </div>
      )}
      {error && (
        <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
          {error}
        </div>
      )}

      {showPad ? (
        <SignaturePad
          label={m.settings_profile_signature_pad_save()}
          onCancel={() => setShowPad(false)}
          onSubmit={(dataUri) => {
            const fd = new FormData();
            fd.append("intent", "save-signature");
            fd.append("signatureBase64", dataUri);
            fetcher.submit(fd, { method: "post" });
            setShowPad(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowPad(true)}
          className="px-4 py-2 bg-ih-bg-muted border border-ih-border text-ih-fg-1 rounded-md font-semibold text-[13px] hover:bg-ih-bg-card hover:border-ih-primary transition-all"
        >
          {saved ? m.settings_profile_signature_update() : m.settings_profile_signature_add()}
        </button>
      )}
    </section>
  );
}
