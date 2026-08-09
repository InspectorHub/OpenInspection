import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { AvatarCropper } from "~/components/media-studio/AvatarCropper";
import { validateImageFile } from "~/lib/image-upload";
import { useNotificationSaveToast } from "~/hooks/useNotificationSaveToast";
import { m } from "~/paraglide/messages";

/**
 * The inspector's profile photo — the third image on this page, and the last
 * one still living in the route.
 *
 * It is here for the same reason the signature cards are: it OWNS ITS OWN SAVE.
 * Choosing a file crops, uploads and reloads with no button anywhere in the
 * flow, which is the page's rule — and holding that in the route meant the
 * route also carried a fetcher, a toast, two pieces of state and a cropper on
 * top of the one form it actually submits.
 */
export function ProfilePhotoCard({ photoUrl }: { photoUrl: string | null }) {
  const [avatarSource, setAvatarSource] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fetcher = useFetcher<{ success?: boolean; error?: string; intent?: string }>();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success && fetcher.data?.intent === "photo-upload") {
      window.location.reload();
    }
  }, [fetcher.state, fetcher.data]);

  // A FAILED upload used to say nothing at all: success reloads the page, and
  // failure left the old photo sitting there looking like nothing had been
  // attempted. On a page whose rule is "no button means it saved", a silent
  // failure is the one thing that breaks the rule.
  useNotificationSaveToast({
    data: fetcher.data?.intent === "photo-upload" && !fetcher.data?.success ? fetcher.data : null,
    failed: true,
    error: fetcher.data?.error ?? null,
  });

  const closeCropper = () => {
    if (avatarSource) URL.revokeObjectURL(avatarSource);
    setAvatarSource(null);
  };

  return (
    <section id="photo" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5 scroll-mt-12">
      <header className="space-y-1">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_profile_photo_heading()}</h3>
        <p className="text-[12px] text-ih-fg-3">{m.settings_profile_photo_subtitle()}</p>
      </header>

      <div className="flex items-center gap-4">
        <div className="w-24 h-24 rounded-full bg-ih-bg-muted border border-ih-border overflow-hidden flex items-center justify-center text-ih-fg-2 text-[11px]">
          {photoUrl ? (
            <img src={photoUrl} alt={m.settings_profile_photo_alt()} className="w-full h-full object-cover" />
          ) : (
            <span>{m.settings_profile_photo_none()}</span>
          )}
        </div>
        <div className="space-y-2">
          {/* The same picker the signature and the badges use: a label wrapping
              a visually-hidden input. The browser's raw file input was the odd
              one out on a page with three image uploads, and it is the only
              control here that cannot be styled to say it is busy. */}
          <label className="h-9 px-3 inline-flex items-center rounded-md border border-ih-border bg-ih-bg-muted text-ih-fg-1 text-[13px] font-semibold cursor-pointer hover:border-ih-primary hover:text-ih-primary-text focus-within:border-ih-primary focus-within:shadow-ih-focus transition-colors">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                // Refused here, before a request: the server's 2 MB limit
                // otherwise reads as an upload that silently did nothing.
                const invalid = validateImageFile(file);
                if (invalid) { setPhotoError(invalid); return; }
                setPhotoError(null);
                setAvatarSource(URL.createObjectURL(file));
              }}
            />
            {m.settings_profile_photo_choose()}
          </label>
          <p className="text-[11px] text-ih-fg-3">{m.settings_profile_photo_hint()}</p>
          {photoError && <p role="alert" className="text-[11px] text-ih-bad-fg">{photoError}</p>}
        </div>
      </div>

      {avatarSource && (
        <AvatarCropper
          sourceUrl={avatarSource}
          onCancel={closeCropper}
          onSave={(blob) => {
            const fd = new FormData();
            fd.append("intent", "photo-upload");
            fd.append("photo", new File([blob], "avatar.jpg", { type: "image/jpeg" }));
            fetcher.submit(fd, { method: "POST", encType: "multipart/form-data" });
            closeCropper();
          }}
        />
      )}
    </section>
  );
}
