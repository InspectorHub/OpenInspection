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
  onUpload,
  onAdd,
  onUpdate,
  onDelete,
}: {
  credentials: EditorCredential[];
  uploadingId: string | null;
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
        <div key={c.id} className="rounded-md border border-ih-border bg-ih-bg-muted/40 p-3 flex items-start gap-3">
          <div className="w-24 shrink-0">
            <LogoUploader currentUrl={c.imageUrl} uploading={uploadingId === c.id} onSelect={(f) => onUpload(c.id, f)} />
          </div>
          <div className="flex-1 min-w-0">
            <details>
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
