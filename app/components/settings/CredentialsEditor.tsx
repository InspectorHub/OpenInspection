// Inspector credentials & association badges editor (Spec B). The acceptance
// bar: the fast path is "upload one image, done" — every row opens on a single
// upload control + a Remove button, and label / member number live behind a
// collapsed <details>. A solo inspector pasting one pre-composed badge strip
// never touches a text field. No expiry input (Spec B §5).
import { useState } from "react";
import { IconButton } from "@core/shared-ui";
import { LogoUploader } from "~/components/media-studio/LogoUploader";
import { PhotoCropper } from "~/components/media-studio/PhotoCropper";
import { BADGE_MAX_LONG_EDGE, isVectorImage, validateImageFile } from "~/lib/image-upload";
import { m } from "~/paraglide/messages";

export interface EditorCredential {
  id: string;
  label: string;
  memberNumber: string | null;
  imageUrl: string | null;
}

export function CredentialsEditor({
  credentials,
  uploadingId,
  uploadError,
  onUpload,
  onAdd,
  onUpdate,
  onDelete,
  onReorder,
}: {
  credentials: EditorCredential[];
  uploadingId: string | null;
  /**
   * Why the last upload was refused, shown on the row it belongs to.
   *
   * A per-row failure needs a per-row message. A toast cannot say WHICH of
   * three uploaders rejected the file, and a rejected upload otherwise looks
   * exactly like a button that does nothing — which is how a 3 MB badge hitting
   * the 2 MB limit reads to the person who chose it.
   */
  uploadError: { id: string; message: string } | null;
  onUpload: (id: string, file: File) => void;
  onAdd: () => void;
  onUpdate: (id: string, patch: { label?: string; memberNumber?: string }) => void;
  onDelete: (id: string) => void;
  /**
   * The full list in its new order. Emitting the whole order rather than a
   * (id, direction) pair keeps the rule for turning positions into `sortOrder`
   * in ONE place — the route — instead of splitting it across a component that
   * knows the order and a handler that has to reconstruct it.
   */
  onReorder: (orderedIds: string[]) => void;
}) {
  /** The row whose badge is being cropped, and the object URL it came from. */
  const [cropTarget, setCropTarget] = useState<{ id: string; url: string } | null>(null);
  /**
   * A file this page refused, before any request was made.
   *
   * Kept separately from `uploadError` (which is the SERVER's answer) because
   * the two arrive at different moments and one does not supersede the other:
   * a local refusal has to survive on screen while nothing at all is in flight.
   */
  const [localError, setLocalError] = useState<{ id: string; message: string } | null>(null);

  const closeCropper = () => {
    if (cropTarget) URL.revokeObjectURL(cropTarget.url);
    setCropTarget(null);
  };

  /**
   * A badge gets cropped like every other image on this page.
   *
   * It used to go to the server byte-for-byte, which made it the one image here
   * with no way to straighten a photographed certificate or trim the margin
   * around a seal — on the surface whose whole purpose is appearing on a
   * published report. Vector badges still pass straight through: rasterizing an
   * SVG to crop it would throw away the reason it was uploaded as an SVG.
   */
  const onSelect = (id: string, file: File) => {
    const invalid = validateImageFile(file);
    if (invalid) { setLocalError({ id, message: invalid }); return; }
    setLocalError(null);
    if (isVectorImage(file)) { onUpload(id, file); return; }
    setCropTarget({ id, url: URL.createObjectURL(file) });
  };

  const shownError = localError ?? uploadError;

  /**
   * ORDER IS THE CHOICE. The first credential carrying a badge is the one that
   * stands beside the signature on every report (`primaryBadgeOf`), so moving a
   * row is how an inspector picks it — there is no separate "primary" toggle to
   * fall out of step with the list.
   */
  const primaryBadgeId = credentials.find((c) => c.imageUrl)?.id ?? null;

  const move = (index: number, delta: number) => {
    const next = [...credentials];
    const [row] = next.splice(index, 1);
    next.splice(index + delta, 0, row);
    onReorder(next.map((c) => c.id));
  };

  return (
    <section id="credentials" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4 scroll-mt-12">
      <div>
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_profile_credentials_heading()}</h3>
        <p className="mt-1 text-[12px] text-ih-fg-3">{m.settings_profile_credentials_subtitle()}</p>
      </div>

      {credentials.length === 0 && (
        <p className="text-[12px] text-ih-fg-3">{m.settings_profile_credentials_empty()}</p>
      )}

      {credentials.map((c, i) => (
        <div key={c.id} className="rounded-md border border-ih-border bg-ih-bg-muted/40 p-3 flex items-start gap-3">
          {/* Up/down rather than drag: this list is two to five rows, and
              buttons work with a keyboard and with a gloved finger on the iPad
              that the drag handle would not. Hidden entirely at one row, where
              there is no order to express. */}
          {credentials.length > 1 && (
            <div className="flex flex-col gap-0.5 shrink-0 pt-0.5">
              <IconButton
                aria-label={m.settings_profile_credentials_move_up()}
                title={m.settings_profile_credentials_move_up()}
                disabled={i === 0}
                onClick={() => move(i, -1)}
                className="w-7 h-7"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              </IconButton>
              <IconButton
                aria-label={m.settings_profile_credentials_move_down()}
                title={m.settings_profile_credentials_move_down()}
                disabled={i === credentials.length - 1}
                onClick={() => move(i, 1)}
                className="w-7 h-7"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </IconButton>
            </div>
          )}
          {/* The uploader's COMPACT size — its default is a wide row that needs
              more than this column has, and squeezing it collapsed the preview
              to a sliver with the button floating off-centre beside it. */}
          <div className="w-32 shrink-0 space-y-1.5">
            <LogoUploader size="compact" currentUrl={c.imageUrl} uploading={uploadingId === c.id} onSelect={(f) => onSelect(c.id, f)} />
            {/* Says what the order DID, on the row it happened to. A paragraph
                above the list would explain the same rule without ever showing
                which credential it currently picked. */}
            {c.id === primaryBadgeId && (
              <p className="text-[11px] text-ih-fg-3 leading-tight">{m.settings_profile_credentials_primary_badge()}</p>
            )}
            {shownError?.id === c.id && (
              <p role="alert" className="text-[11px] text-ih-bad-fg leading-tight">{shownError.message}</p>
            )}
          </div>
          <div className="flex-1 min-w-0">
            {/* OPEN by default. `onAdd` creates a blank row, so a collapsed
                one showed an upload box and the word "Details" with nothing
                saying what the credential is — the two fields are hidden at
                exactly the moment they are needed. Still collapsible, for a
                reader who has already filled several in. */}
            <details open>
              <summary className="text-[12px] text-ih-fg-3 cursor-pointer select-none">{m.settings_profile_credentials_details_summary()}</summary>
              <div className="mt-2 space-y-2">
                <input
                  defaultValue={c.label}
                  placeholder={m.settings_profile_credentials_label_placeholder()}
                  onBlur={(e) => { if (e.target.value !== c.label) onUpdate(c.id, { label: e.target.value }); }}
                  className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
                <input
                  defaultValue={c.memberNumber ?? ""}
                  placeholder={m.settings_profile_credentials_member_placeholder()}
                  onBlur={(e) => { if (e.target.value !== (c.memberNumber ?? "")) onUpdate(c.id, { memberNumber: e.target.value }); }}
                  className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
              </div>
            </details>
          </div>
          <button type="button" onClick={() => onDelete(c.id)} className="text-[12px] font-medium text-ih-bad-fg hover:underline shrink-0">
            {m.settings_profile_credentials_remove()}
          </button>
        </div>
      ))}

      <button type="button" onClick={onAdd} className="text-[13px] font-bold text-ih-primary-text hover:underline">
        {m.settings_profile_credentials_add()}
      </button>

      {cropTarget && (
        <PhotoCropper
          sourceUrl={cropTarget.url}
          // Square first: most association seals are round or square. Free stays
          // available for the wide certificate strips some inspectors upload.
          presets={["1:1", "3:2"]}
          initialAspect="1:1"
          // PNG, so a badge cut out against transparency still is one. As a JPEG
          // it lands on the report cover as a white rectangle.
          outputFormat="image/png"
          maxLongEdge={BADGE_MAX_LONG_EDGE}
          title={m.media_badge_crop_aria()}
          saveLabel={m.media_badge_save()}
          onCancel={closeCropper}
          onSave={(blob) => {
            const { id } = cropTarget;
            closeCropper();
            onUpload(id, new File([blob], "badge.png", { type: "image/png" }));
          }}
        />
      )}
    </section>
  );
}
