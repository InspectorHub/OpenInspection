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
 * THE signature — the mark applied to agreements and published reports.
 *
 * One signature, two equal ways to produce it. Drawing and uploading are
 * siblings, not a primary and a fallback: an inspector with a scanned signature
 * on file has no reason to redraw it with a mouse, and one without a scanner has
 * no way to upload. So the two actions carry the same weight and sit together
 * under the mark they replace.
 *
 * The swatch is a signature LINE, not an image frame: a white field with a
 * hairline baseline, the way a printed form presents the space you sign. Empty,
 * it is the same line — an invitation to sign rather than a grey box announcing
 * that there is nothing there.
 *
 * Everything is left-aligned, including the actions. The card's content is
 * left-aligned, and a centred control under left-aligned content reads as an
 * accident rather than a decision.
 */
export function SavedSignatureCard({ savedSignature }: { savedSignature: string | null }) {
  const fetcher = useFetcher<SaveResult>();
  const [showPad, setShowPad] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const isOurs = fetcher.data?.intent === "save-signature";

  /**
   * WHERE THE ANSWER GOES, and why it is two different places.
   *
   * The SAVE result is a toast. A full-width banner between the heading and the
   * mark pushed the card open, stayed after the moment had passed, and said
   * "Signature saved." directly above a signature that was visibly already
   * there — a receipt for something the reader could see. The mark changing IS
   * the confirmation; the toast is only there for the case where the new one
   * looks like the old one.
   *
   * A FILE the reader just chose and we refused is different: no request was
   * made, the fault is in their hand, and the message has to sit next to the
   * control they will use again. That one stays inline.
   */
  useNotificationSaveToast({
    data: isOurs ? fetcher.data : null,
    failed: isOurs && fetcher.data?.success === false,
    error: isOurs && typeof fetcher.data?.error === "string" ? fetcher.data.error : null,
  });

  const submit = (dataUri: string) => {
    const fd = new FormData();
    fd.append("intent", "save-signature");
    fd.append("signatureBase64", dataUri);
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <section id="saved-signature" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5 scroll-mt-12">
      <header className="space-y-1">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_profile_saved_signature_heading()}</h3>
        <p className="text-[12px] text-ih-fg-3">{m.settings_profile_saved_signature_subtitle()}</p>
      </header>


      {showPad ? (
        <SignaturePad
          label={m.settings_profile_signature_pad_save()}
          onCancel={() => setShowPad(false)}
          onSubmit={(dataUri) => { submit(dataUri); setShowPad(false); }}
        />
      ) : (
        <div className="space-y-3">
          {/* The signing line. White in both themes because that is the paper
              the mark is applied to — a signature previewed on a dark card is
              not the signature anyone receives. */}
          <div
            // ds-allow: documents this mark is applied to are rendered on white
            className="w-full max-w-sm h-28 rounded border border-ih-border bg-white px-5 pb-5 flex items-end"
          >
            {/* The rule is a literal slate hairline, not a token: it lives on a
                fixed-white field, so a theme-aware border would be invisible in
                one of the two themes — which is exactly what it was. */}
            <div
              // ds-allow: fixed-white signing field
              className="w-full border-b border-[#cbd5e1] flex items-end justify-start pb-1.5"
            >
              {savedSignature && (
                <img src={savedSignature} alt={m.settings_profile_saved_signature_alt()} className="max-h-16 w-auto" />
              )}
            </div>
          </div>

          {!savedSignature && (
            <p className="text-[12px] text-ih-fg-3">{m.settings_profile_signature_empty_hint()}</p>
          )}

          {/* Two ways to the same thing, so neither outranks the other. */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { setUploadError(null); setShowPad(true); }}
              className="h-9 px-3 rounded-md border border-ih-border bg-ih-bg-muted text-ih-fg-1 text-[13px] font-semibold hover:border-ih-primary hover:text-ih-primary transition-colors"
            >
              {m.settings_profile_signature_draw()}
            </button>
            <label className="h-9 px-3 inline-flex items-center rounded-md border border-ih-border bg-ih-bg-muted text-ih-fg-1 text-[13px] font-semibold cursor-pointer hover:border-ih-primary hover:text-ih-primary focus-within:border-ih-primary focus-within:shadow-ih-focus transition-colors">
              {/* A label wrapping the input, so the picker opens NATIVELY. The
                  button-plus-`input.click()` pattern depends on a hidden input
                  being clickable, and when it is not there is nothing on screen
                  to say so — the control simply does not respond. */}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setUploadError(await readSignatureFile(file, submit));
                }}
              />
              {m.settings_profile_signature_upload()}
            </label>
          </div>

          {uploadError && (
            <p role="alert" className="text-[12px] text-ih-bad-fg">{uploadError}</p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Read an uploaded signature into a data URI, DOWNSCALED.
 *
 * The column is TEXT and its value is read on every report render and every
 * agreement, so a phone photo pasted in whole would be carried around forever
 * for a mark drawn at a couple of hundred pixels. Raster images are redrawn
 * through a canvas at signature scale; SVG passes through untouched, being
 * resolution-independent already.
 *
 * Returns an error message, or null on success.
 */
async function readSignatureFile(
  file: File,
  onReady: (dataUri: string) => void,
): Promise<string | null> {
  const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
  if (!ALLOWED.includes(file.type)) return m.settings_profile_signature_upload_bad_type();
  if (file.size > 2_000_000) return m.settings_profile_signature_upload_too_big();

  const dataUri = await new Promise<string | null>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
  if (!dataUri) return m.settings_profile_signature_upload_unreadable();

  if (file.type === "image/svg+xml") { onReady(dataUri); return null; }

  const scaled = await new Promise<string | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX_H = 200, MAX_W = 600;
      const ratio = Math.min(MAX_W / img.width, MAX_H / img.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * ratio));
      canvas.height = Math.max(1, Math.round(img.height * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // PNG, so a signature on transparency stays on transparency.
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = dataUri;
  });
  if (!scaled) return m.settings_profile_signature_upload_unreadable();
  onReady(scaled);
  return null;
}
