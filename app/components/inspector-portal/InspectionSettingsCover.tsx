/**
 * #529 — the report-cover picker inside the hub Settings card.
 *
 * Owns the cover state (the photo grid, the chosen key, the cropper) and the
 * cover writes. The pick (set-cover) is a plain object, so it goes through
 * `useGuardedSubmit` like the settings save; the upload and the crop post a
 * `FormData` carrying a file, which that hook's `Record<string, string>`
 * signature cannot carry, so they keep the raw fetcher behind the shared
 * `useActionLatch` (see the submit-guard baseline for the two exemptions).
 * All three surface the action's error rather than a silent revert.
 */
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Button, PENDING_CLASS, pendingProps, useActionLatch } from "@core/shared-ui";
import { CoverCropper, coverCropFor, type StoredCoverCrop } from "@core/field-ui/components/media-studio/CoverCropper";
import { fullResUrl } from "@core/field-ui/components/media-studio/cropImage";
import { photoRefusal } from "@core/field-ui/shared/photo-admission";
import { onlinePhotoRejectionMessages } from "@core/field-ui/editor/photo-rejection-messages";
import { m as fieldM } from "@core/field-ui/i18n";
import type { CoverPhotoOption } from "@core/field-ui/data-source-types";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";
import type { action } from "~/routes/inspector-portal";

export function InspectionSettingsCover({
    inspection,
    initialPhotos,
    initialCoverKey,
    canEdit,
}: {
    inspection: Record<string, unknown> | null;
    initialPhotos: CoverPhotoOption[];
    initialCoverKey: string;
    canEdit: boolean;
}) {
    // DB-16 — report cover picker. `photos` are all of the inspection's photos;
    // `coverKey` is the chosen cover R2 key (optimistic).
    const [photos, setPhotos] = useState<CoverPhotoOption[]>(initialPhotos);
    const [coverKey, setCoverKey] = useState<string>(initialCoverKey);
    const [uploadingCover, setUploadingCover] = useState(false);
    const [coverError, setCoverError] = useState<string | null>(null);
    const coverFileRef = useRef<HTMLInputElement>(null);
    const [cropSource, setCropSource] = useState<{ key: string; url: string } | null>(null);
    // The crop saved during THIS card session: `crop-cover` does not reload the section, so `inspection`
    // still holds the crop from when it loaded, and re-cropping would re-open on a frame already replaced.
    const [sessionCrop, setSessionCrop] = useState<{ key: string; crop: StoredCoverCrop } | null>(null);
    // The crop the in-flight crop-cover submit carries: only the answer confirms it, so the session crop is
    // recorded from here, not at submit time — a failed crop must not become the frame a re-crop re-opens on.
    const pendingCrop = useRef<{ key: string; crop: StoredCoverCrop } | null>(null);

    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    // The pick is a plain object, so it takes the guarded submit: a same-frame
    // repeat is refused, and the optimistic clear below runs only when the
    // submit was accepted — a refused pick leaves the selection shown.
    const { fetcher: pickFetcher, submit: pickSubmit, busy: pickBusy } = useGuardedSubmit<typeof action>();
    // One fetcher for the two file-carrying cover writes (upload, crop); one
    // guard for both, since they all rewrite the cover of this inspection.
    const coverFetcher = useFetcher<typeof action>();
    const coverBusy = coverFetcher.state !== "idle";
    const coverLatch = useActionLatch(coverBusy);
    // The cover key the last set-cover submit optimistically showed, so a refused write can put it back.
    const coverBefore = useRef("");

    // A pick's answer: a refused clear reverts to the key from before it.
    useEffect(() => {
        if (pickFetcher.state !== "idle" || !pickFetcher.data) return;
        const data = pickFetcher.data as { intent?: string; ok?: boolean; error?: string };
        if (data.intent !== "set-cover" || data.ok) return;
        setCoverKey(coverBefore.current);
        setCoverError(data.error ?? m.inspections_hub_error_set_cover());
    }, [pickFetcher.state, pickFetcher.data]);

    // An upload's or a crop's answer: upload appends the new photo to the grid
    // and opens it for cropping; crop records the new key.
    useEffect(() => {
        if (coverFetcher.state !== "idle" || !coverFetcher.data) return;
        const data = coverFetcher.data as { intent?: string; ok?: boolean; error?: string; coverKey?: string | null; coverUrl?: string | null };
        if (data.intent === "upload-cover") {
            setUploadingCover(false);
            if (!data.ok || !data.coverKey) {
                setCoverError(data.error ?? m.inspections_hub_error_upload_cover());
                return;
            }
            setCoverError(null);
            setCoverKey(data.coverKey);
            if (data.coverUrl) {
                setPhotos((prev) =>
                    prev.some((p) => p.key === data.coverKey) ? prev : [{ key: data.coverKey as string, url: data.coverUrl as string, label: fieldM.editor_settings_cover_uploaded_label() }, ...prev],
                );
                setCropSource({ key: data.coverKey, url: data.coverUrl });
            }
            return;
        }
        if (data.intent === "crop-cover") {
            if (!data.ok) {
                setCoverError(data.error ?? m.inspections_hub_error_crop_cover());
                return;
            }
            setCoverError(null);
            if (data.coverKey) setCoverKey(data.coverKey);
            if (pendingCrop.current) {
                setSessionCrop(pendingCrop.current);
                pendingCrop.current = null;
            }
        }
    }, [coverFetcher.state, coverFetcher.data]);

    function selectCover(key: string) {
        if (!canEdit) return;
        setCoverError(null);
        if (coverKey === key) {
            coverBefore.current = coverKey;
            if (pickSubmit({ intent: "set-cover", coverPhotoId: "" }, { method: "post" })) {
                setCoverKey("");
            }
            return;
        }
        const photo = photos.find((p) => p.key === key);
        if (photo) setCropSource({ key, url: photo.url });
    }

    // DB-16 — direct cover upload. The latch drops a repeat (same frame, or while a check is pending).
    function uploadCover(file: File) {
        if (!canEdit) return;
        coverLatch(() => {
            setUploadingCover(true);
            setCoverError(null);
            // The photo check first (size ceiling, type by bytes): a file the server would refuse is announced with the
            // photo wording and never sent.
            void photoRefusal(file).then((refusal) => {
                if (refusal !== null) {
                    const [message] = onlinePhotoRejectionMessages([{ index: 0, ok: false, error: refusal }]);
                    if (mounted.current) {
                        setCoverError(message ?? fieldM.editor_photo_save_failed());
                        setUploadingCover(false);
                    }
                    return;
                }
                const fd = new FormData();
                fd.set("intent", "upload-cover");
                fd.set("file", file);
                coverFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
            });
        });
    }

    const labelClass = "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3";

    return (
        <>
            <span className={`${labelClass} block pt-1`}>{fieldM.editor_settings_legend_cover()}</span>
            <input
                ref={coverFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadCover(file);
                    e.target.value = ""; // allow re-selecting the same file
                }}
            />
            {photos.length === 0 ? (
                <p className="text-[12px] text-ih-fg-3">{fieldM.editor_settings_cover_empty()}</p>
            ) : (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2" data-testid="hub-settings-cover-grid">
                    {photos.map((p) => {
                        const selected = coverKey === p.key;
                        return (
                            <button
                                key={p.key}
                                type="button"
                                {...pendingProps(pickBusy, () => selectCover(p.key))}
                                title={selected ? fieldM.editor_settings_cover_current() : p.label ? fieldM.editor_settings_cover_set_labeled({ label: p.label }) : fieldM.editor_settings_cover_set()}
                                disabled={!canEdit}
                                aria-busy={pickBusy || undefined}
                                className={`relative aspect-square rounded-md overflow-hidden border-2 transition-colors ${selected ? "border-ih-primary" : "border-ih-border hover:border-ih-primary/60"} disabled:opacity-60 ${PENDING_CLASS}`}
                            >
                                <img src={p.url} alt={p.label || fieldM.editor_settings_cover_photo_alt()} className="w-full h-full object-cover" loading="lazy" />
                                {selected && (
                                    <span className="absolute inset-x-0 bottom-0 bg-ih-primary text-ih-fg-inverse text-[9px] font-bold text-center py-0.5">{fieldM.editor_settings_cover_badge()}</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
            {canEdit && (
                <div className="pt-1 space-y-1">
                    <Button variant="secondary" size="sm" onClick={() => coverFileRef.current?.click()} pending={coverBusy && uploadingCover}>
                        {coverBusy && uploadingCover ? fieldM.editor_uploading() : fieldM.editor_settings_cover_upload()}
                    </Button>
                    <p className="text-[11px] text-ih-fg-3">{fieldM.editor_settings_cover_hint()}</p>
                </div>
            )}
            {coverError && <p className="text-[12px] font-medium text-ih-bad-fg">{coverError}</p>}
            {cropSource && (
                <CoverCropper
                    sourceUrl={fullResUrl(cropSource.url)}
                    sourceKey={cropSource.key}
                    initialCrop={sessionCrop?.key === cropSource.key ? sessionCrop.crop : coverCropFor(inspection, cropSource.key)}
                    onCancel={() => setCropSource(null)}
                    onSave={(blob, c) => {
                        const source = cropSource;
                        const crop = { aspect: c.aspect, orientation: c.orientation, ...c.pixels };
                        const image = new File([blob], "cover.jpg", { type: "image/jpeg" });
                        // Checked first: an image the server would refuse is announced, nothing is sent and the cropper stays open.
                        void photoRefusal(image).then((refusal) => {
                            if (refusal || !mounted.current) return;
                            setCropSource(null);
                            const fd = new FormData();
                            fd.set("intent", "crop-cover");
                            fd.set("image", image);
                            fd.set("sourceKey", source.key);
                            fd.set("crop", JSON.stringify(crop));
                            coverLatch(() => {
                                pendingCrop.current = { key: source.key, crop };
                                coverFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
                            });
                        });
                    }}
                />
            )}
        </>
    );
}
