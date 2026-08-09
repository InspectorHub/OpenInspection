/**
 * Create / edit an agreement TEMPLATE (#67).
 *
 * The body is loaded LAZILY, through the resource route, rather than coming
 * down with the Library page. An agreement is the longest text this product
 * stores and a workspace has several; shipping every one of them on a page that
 * renders four columns of metadata would pay for all of them to open one. The
 * loader also re-reads on open, so an author never edits on top of a copy that
 * went stale while the page sat there.
 *
 * SAVING IS BLOCKED ON AN EMPTY BODY HERE AS WELL AS IN THE ROUTE. Not
 * duplication for its own sake: the route's refusal is the one that protects
 * the data, and this one is the one that tells somebody why before they press
 * a button. They are the same rule read from the same helper.
 *
 * #83 — THE CANCELLATION-CLAUSE WARNING IS NOT A BLOCK, AND MUST NOT BECOME
 * ONE. `updateAgreement` increments `agreements.version` on every save (it
 * compares nothing, so re-saving identical text bumps it too) and
 * `getCancellationAttestation()` invalidates on that comparison — so editing the
 * template the fees rest on revokes the confirmation and `updateBranding` starts
 * refusing fee-charging policies. That is CORRECT: an agreement whose words
 * changed has genuinely not been re-confirmed, and skipping the bump would make
 * the attestation worthless. What was missing is that nobody was told. So this
 * banner states the cost and names the destination, and the Save button behaves
 * exactly as it does for any other template — no extra tick-box, which would
 * only read as absolution, and no refusal, which would trap an author inside
 * their own agreement.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Modal, Input, Button, Banner } from "@core/shared-ui";
import { AgreementRichText } from "./AgreementRichText";
import { agreementContentToEditorHtml, agreementHtmlIsEmpty } from "~/lib/agreement-markup";
import type {
    AgreementTemplateLoadResult,
    AgreementTemplateSaveResult,
} from "~/routes/resources/agreement-templates";
import { AGREEMENT_TEMPLATES_ACTION } from "~/routes/resources/agreement-templates";
import { m } from "~/paraglide/messages";

export function AgreementTemplateModal({
    open,
    templateId,
    onClose,
    onSaved,
}: {
    open: boolean;
    /** `null` creates a new template; an id edits that one. */
    templateId: string | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const loadFetcher = useFetcher<AgreementTemplateLoadResult>();
    const saveFetcher = useFetcher<AgreementTemplateSaveResult>();
    const nameRef = useRef<HTMLInputElement>(null);
    const hintId = useId();

    const [name, setName] = useState("");
    const [content, setContent] = useState("");
    const [localError, setLocalError] = useState<string | null>(null);
    const editing = templateId !== null;
    const saving = saveFetcher.state !== "idle";

    // Opening is what triggers the read — not mounting, which happens once for
    // every row on the page.
    useEffect(() => {
        if (!open) return;
        setLocalError(null);
        if (!templateId) {
            setName("");
            setContent("");
            return;
        }
        setName("");
        setContent("");
        loadFetcher.load(`${AGREEMENT_TEMPLATES_ACTION}?id=${encodeURIComponent(templateId)}`);
        // `loadFetcher` is a stable-enough handle; re-running on its identity
        // would refetch on every state change it causes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, templateId]);

    useEffect(() => {
        const data = loadFetcher.data;
        if (!data || loadFetcher.state !== "idle") return;
        if (!data.ok) return;
        setName(data.template.name);
        // Normalised on the way IN as well as out: a stored template predating
        // this editor is plain text, and dropping it into a contenteditable
        // unconverted would show one unbroken block where its clauses were.
        setContent(agreementContentToEditorHtml(data.template.content));
    }, [loadFetcher.data, loadFetcher.state]);

    useEffect(() => {
        if (saveFetcher.state !== "idle" || !saveFetcher.data) return;
        if (saveFetcher.data.ok) onSaved();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [saveFetcher.state, saveFetcher.data]);

    const submit = () => {
        if (!name.trim()) {
            setLocalError(m.library_agreement_editor_err_name_required());
            nameRef.current?.focus();
            return;
        }
        if (agreementHtmlIsEmpty(content)) {
            setLocalError(m.library_agreement_editor_err_body_required());
            return;
        }
        setLocalError(null);
        saveFetcher.submit(
            {
                intent: editing ? "update" : "create",
                ...(editing ? { id: templateId } : {}),
                name: name.trim(),
                content,
            },
            { method: "post", action: AGREEMENT_TEMPLATES_ACTION },
        );
    };

    const loadData = loadFetcher.state === "idle" ? loadFetcher.data : undefined;
    const loadError = loadData && !loadData.ok ? loadData.error : null;
    // Scoped to the ONE template the live attestation names — the loader gets
    // that from the branding endpoint, which computes it with the same function
    // the fee gate reads. Never derived here.
    const clauseAttested = loadData?.ok === true && loadData.clauseAttested;
    const saveData = saveFetcher.state === "idle" ? saveFetcher.data : undefined;
    const serverError = saveData && !saveData.ok ? saveData.error : null;
    const loading = editing && loadFetcher.state === "loading";

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={editing ? m.library_agreement_editor_title_edit() : m.library_agreement_editor_title_new()}
            size="xl"
            initialFocusRef={nameRef}
            footer={
                <>
                    <Button variant="ghost" onClick={onClose} disabled={saving}>
                        {m.common_cancel()}
                    </Button>
                    <Button variant="primary" onClick={submit} disabled={saving || loading || !!loadError}>
                        {saving ? m.common_saving() : m.common_save()}
                    </Button>
                </>
            }
        >
            <div className="space-y-4">
                {loadError && <Banner tone="danger">{loadError}</Banner>}
                {(localError || serverError) && <Banner tone="danger">{localError ?? serverError}</Banner>}
                {/* `warn` is the DS `ih-watch` family — this is a consequence to
                    read before saving, not a failure and not an error. */}
                {clauseAttested && (
                    <Banner tone="warn">{m.library_agreement_editor_clause_warning()}</Banner>
                )}

                <Input
                    ref={nameRef}
                    id="agreement-template-name"
                    label={m.library_agreement_editor_name_label()}
                    placeholder={m.library_agreement_editor_name_placeholder()}
                    value={name}
                    disabled={loading || saving}
                    maxLength={100}
                    onChange={(event) => setName(event.target.value)}
                />

                <div>
                    {/* Same key the editor uses for its own `aria-label`, so
                        the visible label and the announced one cannot drift. */}
                    <span className="block text-xs font-bold text-ih-fg-2 mb-1">
                        {m.agreement_editor_body_label()}
                    </span>
                    <AgreementRichText
                        value={content}
                        onChange={setContent}
                        disabled={loading || saving}
                        describedBy={hintId}
                    />
                    {/* fg-3, not fg-4 — 11px is normal-size text and owes 4.5:1.
                        See `npm run lint:contrast`. */}
                    <p id={hintId} className="text-[11px] text-ih-fg-3 mt-1.5">
                        {m.library_agreement_editor_body_hint()}
                    </p>
                </div>
            </div>
        </Modal>
    );
}
