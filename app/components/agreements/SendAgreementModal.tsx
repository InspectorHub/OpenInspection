import { useState, useEffect } from "react";
import { Button } from "@core/shared-ui";

/**
 * Track I-a Task 9 — shared multi-signer send modal. Self-contained (no route
 * coupling): the parent owns submission via `onSend`, so the same modal mounts
 * on the admin Signing tab and (later) the #111 inspection hub. Collects N
 * signer rows (name + email + role) and a completion policy. Admin surface →
 * DS tokens, light/dark via data-color-scheme. No native confirm/alert.
 */

export type SignerRole = "client" | "co_client" | "agent" | "other";

export interface SignerDraft {
    name: string;
    email: string;
    role: SignerRole;
}

export interface SendAgreementPayload {
    signers: SignerDraft[];
    completionPolicy: "all" | "one";
}

const ROLE_OPTIONS: Array<{ value: SignerRole; label: string }> = [
    { value: "client", label: "Client" },
    { value: "co_client", label: "Co-client" },
    { value: "agent", label: "Agent" },
    { value: "other", label: "Other" },
];

/** Internal row state: extends SignerDraft with a stable UUID key for React reconciliation. */
export interface SignerDraftRow extends SignerDraft {
    key: string;
}

/** Factory for a new, empty signer row. The `key` is stable across re-renders. */
export function emptySigner(): SignerDraftRow {
    return { name: "", email: "", role: "client", key: crypto.randomUUID() };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Pure validation: every row needs a name + a plausible email, no duplicate
 * emails (case-insensitive), at least one row. Returns the first problem or
 * null when the draft is submittable.
 */
export function validateSigners(signers: SignerDraft[]): string | null {
    if (signers.length === 0) return "Add at least one signer.";
    const seen = new Set<string>();
    for (const s of signers) {
        if (!s.name.trim()) return "Every signer needs a name.";
        const email = s.email.trim().toLowerCase();
        if (!EMAIL_RE.test(email)) return `"${s.email || "(empty)"}" is not a valid email.`;
        if (seen.has(email)) return `Duplicate signer email: ${s.email}.`;
        seen.add(email);
    }
    return null;
}

/**
 * Pure submit-payload builder: trims each signer's name/email (preserving role)
 * and pairs them with the completion policy. The `key` field (stable row identity
 * used by React reconciliation) is stripped — it must not reach the server.
 * The parent serializes this into the route's `send` intent. Kept pure so the
 * wiring can be unit-tested without a render harness (happy-dom has none in this repo).
 */
export function buildSendPayload(
    signers: SignerDraft[] | SignerDraftRow[],
    completionPolicy: "all" | "one",
): SendAgreementPayload {
    return {
        // Destructure to drop any `key` field that may be present on SignerDraftRow.
        signers: signers.map(({ name, email, role }) => ({ name: name.trim(), email: email.trim(), role })),
        completionPolicy,
    };
}

export function SendAgreementModal({
    onSend,
    onClose,
    busy,
    initialSigners,
}: {
    onSend: (payload: SendAgreementPayload) => void;
    onClose: () => void;
    busy?: boolean;
    initialSigners?: SignerDraft[];
}) {
    const [signers, setSigners] = useState<SignerDraftRow[]>(() => {
        if (initialSigners && initialSigners.length > 0) {
            // Attach stable keys to any externally-supplied initial rows.
            return initialSigners.map((s) => ({ ...s, key: crypto.randomUUID() }));
        }
        return [emptySigner()];
    });
    const [completionPolicy, setCompletionPolicy] = useState<"all" | "one">("all");
    const [error, setError] = useState<string | null>(null);

    const update = (i: number, patch: Partial<SignerDraft>) =>
        setSigners((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    const addRow = () => setSigners((prev) => [...prev, emptySigner()]);
    const removeRow = (i: number) => setSigners((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

    const submit = () => {
        const problem = validateSigners(signers);
        if (problem) { setError(problem); return; }
        setError(null);
        onSend(buildSendPayload(signers, completionPolicy));
    };

    // Escape to close — repo idiom: document listener, clean up on unmount.
    useEffect(() => {
        const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', fn);
        return () => document.removeEventListener('keydown', fn);
    }, [onClose]);

    return (
        <div className="fixed inset-0 bg-[rgba(15,23,42,0.4)] flex items-center justify-center z-50 p-4">
            <div className="bg-ih-bg-card rounded-lg p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto">
                <h3 className="text-lg font-semibold text-ih-fg-1 mb-1">Send for signing</h3>
                <p className="text-[13px] text-ih-fg-3 mb-4">
                    Add each person who must sign. They each receive their own private link.
                </p>

                <div className="space-y-3">
                    {signers.map((s, i) => (
                        <div key={s.key} className="flex items-start gap-2">
                            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <input
                                    type="text"
                                    value={s.name}
                                    placeholder="Full name"
                                    aria-label="Signer name"
                                    disabled={busy}
                                    onChange={(e) => update(i, { name: e.target.value })}
                                    className="px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1 focus:ring-2 focus:ring-ih-primary/30 outline-none"
                                />
                                <input
                                    type="email"
                                    value={s.email}
                                    placeholder="email@example.com"
                                    aria-label="Signer email"
                                    disabled={busy}
                                    onChange={(e) => update(i, { email: e.target.value })}
                                    className="px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1 focus:ring-2 focus:ring-ih-primary/30 outline-none"
                                />
                            </div>
                            <select
                                value={s.role}
                                disabled={busy}
                                onChange={(e) => update(i, { role: e.target.value as SignerRole })}
                                className="px-2 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1 focus:ring-2 focus:ring-ih-primary/30 outline-none"
                                aria-label="Signer role"
                            >
                                {ROLE_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={() => removeRow(i)}
                                disabled={busy || signers.length === 1}
                                aria-label="Remove signer"
                                className="px-2 py-2 text-ih-fg-3 hover:text-ih-bad-fg disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>

                <button
                    type="button"
                    onClick={addRow}
                    disabled={busy}
                    className="mt-3 text-[13px] font-semibold text-ih-primary hover:opacity-80 disabled:opacity-40"
                >
                    + Add signer
                </button>

                <fieldset className="mt-5">
                    <legend className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-2">Completion</legend>
                    <div className="space-y-2">
                        <label className="flex items-start gap-2.5 cursor-pointer">
                            <input
                                type="radio"
                                name="completionPolicy"
                                checked={completionPolicy === "all"}
                                disabled={busy}
                                onChange={() => setCompletionPolicy("all")}
                                className="mt-0.5 h-4 w-4 text-ih-primary focus:ring-ih-primary/30"
                            />
                            <span className="text-[13px] text-ih-fg-2">Everyone must sign</span>
                        </label>
                        <label className="flex items-start gap-2.5 cursor-pointer">
                            <input
                                type="radio"
                                name="completionPolicy"
                                checked={completionPolicy === "one"}
                                disabled={busy}
                                onChange={() => setCompletionPolicy("one")}
                                className="mt-0.5 h-4 w-4 text-ih-primary focus:ring-ih-primary/30"
                            />
                            <span className="text-[13px] text-ih-fg-2">Any one signature completes it</span>
                        </label>
                    </div>
                </fieldset>

                {error && <p className="text-[13px] text-ih-bad-fg mt-3">{error}</p>}

                <div className="flex justify-end gap-3 mt-6">
                    <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button variant="primary" onClick={submit} disabled={busy}>
                        {busy ? "Sending…" : "Send"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
