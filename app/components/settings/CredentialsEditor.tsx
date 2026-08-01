// Inspector credentials & association badges editor (Spec B). The acceptance
// bar: the fast path is "upload one image, done" — every row opens on a single
// upload control + a Remove button, and label / member number live behind a
// collapsed <details>. A solo inspector pasting one pre-composed badge strip
// never touches a text field. No expiry input (Spec B §5).
import { LogoUploader } from "~/components/media-studio/LogoUploader";
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
}) {
  return (
    <section id="credentials" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4 scroll-mt-12">
      <div>
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_profile_credentials_heading()}</h3>
        <p className="mt-1 text-[12px] text-ih-fg-3">{m.settings_profile_credentials_subtitle()}</p>
      </div>

      {credentials.length === 0 && (
        <p className="text-[12px] text-ih-fg-4">{m.settings_profile_credentials_empty()}</p>
      )}

      {credentials.map((c) => (
        <div key={c.id} className="rounded-md border border-ih-border bg-ih-bg-muted/40 p-3 flex items-start gap-4">
          {/* The uploader's COMPACT size — its default is a wide row that needs
              more than this column has, and squeezing it collapsed the preview
              to a sliver with the button floating off-centre beside it. */}
          <div className="w-32 shrink-0 space-y-1.5">
            <LogoUploader size="compact" currentUrl={c.imageUrl} uploading={uploadingId === c.id} onSelect={(f) => onUpload(c.id, f)} />
            {uploadError?.id === c.id && (
              <p role="alert" className="text-[11px] text-ih-bad-fg leading-tight">{uploadError.message}</p>
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

      <button type="button" onClick={onAdd} className="text-[13px] font-bold text-ih-primary hover:underline">
        {m.settings_profile_credentials_add()}
      </button>
    </section>
  );
}
