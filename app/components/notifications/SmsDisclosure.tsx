import { m } from "~/paraglide/messages";

/**
 * What a reader is agreeing to, wherever they agree to it.
 *
 * Two places capture SMS consent — the public `/sms-optin/:token` page and the
 * inline grant on the notifications screen — and both must show the SAME thing,
 * because both stamp the same `disclosure_version` into the same ledger. Two
 * copies of this markup would let one of them drift, and the drift would be
 * invisible: the row would still claim the reader saw version N.
 *
 * The privacy and terms links belong here for the same reason. They were on the
 * opt-in page and missing from the inline grant, which meant one of the two
 * paths was recording consent against a disclosure the reader could not fully
 * read.
 */
export function SmsDisclosure({
    text, privacyUrl, termsUrl,
}: {
    text: string;
    privacyUrl?: string | null | undefined;
    termsUrl?: string | null | undefined;
}) {
    return (
        <div className="bg-ih-bg-muted border border-ih-border rounded-xl p-4">
            <p className="text-xs text-ih-fg-3 leading-relaxed whitespace-pre-line">{text}</p>
            {(privacyUrl || termsUrl) && (
                <p className="text-xs text-ih-fg-3 leading-relaxed mt-2">
                    {privacyUrl && (
                        <a href={privacyUrl} target="_blank" rel="noreferrer" className="underline">
                            {m.sms_optin_privacy_link()}
                        </a>
                    )}
                    {privacyUrl && termsUrl && <span> · </span>}
                    {termsUrl && (
                        <a href={termsUrl} target="_blank" rel="noreferrer" className="underline">
                            {m.sms_optin_terms_link()}
                        </a>
                    )}
                </p>
            )}
        </div>
    );
}
