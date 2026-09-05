import { useActionData, useLoaderData, useNavigation } from "react-router";
import { Banner, Card, EmptyState } from "@core/shared-ui";

import type { Route } from "./+types/settings-statutory-forms";
import { AccessDenied } from "~/components/AccessDenied";
import { LoadFailedNotice } from "~/components/LoadFailedNotice";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import {
    StatutorySourceRow,
    type StatutorySourceRowData,
} from "~/components/statutory/StatutorySourceRow";
import {
    StatutoryReadinessCard,
    type StatutoryReadinessData,
} from "~/components/statutory/StatutoryReadinessCard";
import { useDisplayLocale, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { requireOwnerLoader } from "~/lib/access.server";
import { createApi } from "~/lib/api-client.server";
import { m } from "~/paraglide/messages";

/**
 * Settings → Statutory form PDFs.
 *
 * ── WHY THIS SCREEN EXISTS ──────────────────────────────────────────────────
 * A statutory form renders onto the issuing authority's own published PDF, and
 * that PDF is not carried in this repository. `POST /api/admin/statutory-forms/
 * {formId}/source` has always been able to receive it, and until now nothing in
 * `app/` called that endpoint — so the only way to supply the file was to
 * hand-craft a multipart request. Meanwhile the marketplace install refuses a
 * statutory package with a message naming that endpoint, which told an operator
 * precisely what they could not do from the product.
 *
 * ── WHY SETTINGS AND NOT LIBRARY ────────────────────────────────────────────
 * `/library/*` is a workspace's own content — things it authors, installs and
 * edits. This is none of those: it is a DEPLOYMENT prerequisite, owner-only,
 * done once per revision and shared by every workspace in the deployment (the
 * bytes live under one `_platform/` key, deliberately not tenant-scoped). That
 * is the same shape as `/settings/imports`, which is also an owner supplying a
 * file the server verifies and refuses in its own words, and it sits in the
 * Compliance group beside the other things a deployment has to have right in
 * order to be allowed to produce a document at all.
 *
 * ── OWNER, NOT ADMIN ────────────────────────────────────────────────────────
 * The API guard is `requireRole('owner')`. Gating this page on the wider admin
 * tier would offer a manager a form whose every submission answers 403.
 */
export function meta() {
    return [{ title: m.statutory_source_page_title() }];
}

/** The GET's body, exactly as the route module declares it. */
interface SourceListBody {
    data?: { storageBound?: boolean; revisions?: StatutorySourceRowData[]; readiness?: StatutoryReadinessData };
}

export async function loader({ context, request }: Route.LoaderArgs) {
    const { forbidden, token } = await requireOwnerLoader(context, request);
    if (forbidden) {
        return { forbidden: true, loadFailed: false, storageBound: true, revisions: [] as StatutorySourceRowData[], readiness: null };
    }

    const api = createApi(context, { token });
    const res = await api.admin["statutory-forms"].$get();
    if (!res.ok) {
        // A failed read is NOT an empty catalogue. Defaulting to zero rows here
        // would render "this build publishes no statutory forms" — a statement
        // about the software, made on the strength of a request that failed,
        // and one an operator would reasonably act on by giving up.
        return { forbidden: false, loadFailed: true, storageBound: true, revisions: [] as StatutorySourceRowData[], readiness: null };
    }
    const body = (await res.json()) as SourceListBody;
    return {
        forbidden: false,
        loadFailed: false,
        // Pessimistic default: a body that did not say leaves the "no storage
        // bound" warning up rather than hiding a reason uploads cannot land.
        storageBound: body.data?.storageBound ?? false,
        revisions: body.data?.revisions ?? [],
        // null, never an empty shape: a readiness card built from a body that
        // did not carry one would tick nothing and read as "nothing is set up",
        // which is a claim about the workspace made on the strength of a
        // response that said nothing.
        readiness: body.data?.readiness ?? null,
    };
}

/**
 * The upload.
 *
 * Everything is forwarded to the API through the token-relay client — a
 * `fetch('/api/…')` from the browser carries no session and would 401. The FILE
 * reaches it as multipart because the typed client re-encodes `form:` as a
 * `FormData`, exactly as `/settings/imports` and the branding-logo upload do;
 * nothing here reads the bytes, so a large PDF is not buffered into a string on
 * the way past.
 */
export async function action({ context, request }: Route.ActionArgs) {
    const { forbidden, token } = await requireOwnerLoader(context, request);
    if (forbidden) return { ok: false as const, formId: "", revision: "", serverError: null };

    const form = await request.formData();
    const formId = String(form.get("formId") ?? "");
    const revision = String(form.get("revision") ?? "");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
        // The one refusal this side owns, because the server cannot make it:
        // an empty part would reach it as "a `file` part is required", which is
        // a sentence about a request rather than about the screen.
        return { ok: false as const, formId, revision, serverError: m.statutory_source_needs_file() };
    }

    const api = createApi(context, { token });
    const res = await api.admin["statutory-forms"][":formId"].source.$post({
        param: { formId },
        form: { revision, file },
    } as Parameters<typeof api.admin["statutory-forms"][":formId"]["source"]["$post"]>[0]);

    if (!res.ok) {
        // RELAY THE SERVER'S OWN SENTENCE, UNALTERED.
        //
        // Its refusal names this file's sha256, the one the revision records,
        // the fact that the revision is printed inside the document and not in
        // its filename, and the address the authority publishes it at. That is
        // the entire remedy, and it is the reason the endpoint bothers to
        // compute the hash it rejected rather than just saying no. Collapsing
        // it into "Upload failed" was found and fixed once already in this
        // subsystem, on the marketplace install path (see 20180061); this is
        // the same mistake's other half, so it is not made here.
        //
        // A refusal that carried no message of its own (a gateway error, an
        // unparseable body) leaves this null and the ROW falls back to its own
        // localised sentence.
        const serverError = await res.json()
            .then((b) => (b as { error?: { message?: string } })?.error?.message ?? null)
            .catch(() => null);
        return { ok: false as const, formId, revision, serverError };
    }
    return { ok: true as const, formId, revision, serverError: null };
}

export default function SettingsStatutoryForms() {
    const { forbidden, loadFailed, storageBound, revisions, readiness } = useLoaderData<typeof loader>();
    const result = useActionData<typeof action>();
    const navigation = useNavigation();
    const locale = useDisplayLocale();
    const timeZone = useDisplayTimeZone();

    if (forbidden) return <AccessDenied />;

    // Which row is mid-upload. Read off the in-flight submission rather than
    // tracked in state: with one action serving every row, a single `busy` flag
    // would grey out every button on the page and imply the others were doing
    // something too.
    //
    // Keyed off `formData` rather than off `state === "submitting"`: a form POST
    // passes through "submitting" and then "loading" while the loader re-reads
    // presence, and a button that re-enabled between the two is live again while
    // the answer is still on its way. `formData` is set through both phases and
    // undefined when idle.
    const submitting = navigation.formData;
    const pending = navigation.state !== "idle" && submitting
        ? `${String(submitting.get("formId"))} ${String(submitting.get("revision"))}`
        : null;

    return (
        <div className="space-y-ih-list">
            <SettingsCrumb
                items={[
                    { label: m.settings_crumb_settings(), href: "/settings" },
                    { label: m.statutory_source_page_title() },
                ]}
            />
            <p className="text-[13px] text-ih-fg-3">{m.statutory_source_subtitle()}</p>

            {/* An empty list here is a conclusion; say when it is not a real one. */}
            {loadFailed && (
                <div className="space-y-2">
                    <LoadFailedNotice />
                    <p className="text-[12px] text-ih-fg-3">{m.statutory_source_load_failed_hint()}</p>
                </div>
            )}

            {/* Above the rows, because it is true of all of them: with no bucket
                bound there is nowhere for an accepted file to be written, and an
                operator should read that before choosing one rather than after
                the request comes back. */}
            {!storageBound && !loadFailed && (
                <Banner tone="danger">{m.statutory_source_no_storage()}</Banner>
            )}

            {/* The whole question, before the one part of it this page can act
                on. It renders even when the server could not compute it: the
                card then SAYS it could not check, rather than disappearing.
                A card that vanishes is indistinguishable from a feature that
                was removed, and it teaches a returning reader nothing.

                Withheld only when the whole read failed, because the notice
                above already says that and two failure notices is one too
                many. */}
            {!loadFailed && (
                <StatutoryReadinessCard readiness={readiness} />
            )}

            {revisions.length === 0 && !loadFailed ? (
                <Card>
                    <EmptyState
                        title={m.statutory_source_empty_title()}
                        description={m.statutory_source_empty_desc()}
                    />
                </Card>
            ) : (
                <div className="space-y-ih-list">
                    {revisions.map((row) => {
                        const key = `${row.formId} ${row.revision}`;
                        return (
                            <StatutorySourceRow
                                key={key}
                                row={row}
                                locale={locale}
                                timeZone={timeZone}
                                busy={pending === key}
                                // Scoped to the row it belongs to. One shared
                                // banner would report a refusal of the TREC
                                // revision above a different revision's form.
                                result={
                                    result && result.formId === row.formId && result.revision === row.revision
                                        ? (result.ok
                                            ? { ok: true }
                                            : { ok: false, serverError: result.serverError })
                                        : null
                                }
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
}
