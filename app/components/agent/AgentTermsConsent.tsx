import { Banner } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * The agent terms, shown — not referred to.
 *
 * This exists as its own component because the signup page crossed the file-size
 * gate, and this was the block worth lifting: it is the whole presentation half of
 * one legal requirement, and it has a rule of its own that a reader should find in
 * one place rather than inline among form fields.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * The tick says "I have read and accept the Agent Terms" and the account records
 * the version and content hash of the text shown. For a while the page displayed
 * nothing and linked nowhere, so the acceptance asserted a presentation that had
 * never happened — the same defect review review §26d-2 closed for e-signature,
 * where intent must come from a recorded act rather than be inferred from an
 * artefact existing. So the body is rendered in full, in the page, above the tick.
 *
 * Scrollable rather than truncated, and deliberately not a "read more" link: the
 * acceptance names the hash of the WHOLE body, so an excerpt would make the record
 * describe something the signer was never given.
 */

/** The agent terms as the page received them. Null means none are published. */
export interface AgentTermsInForce {
    version: string;
    contentHash: string;
    body: string;
}

interface Props {
    terms: AgentTermsInForce | null;
    /** conform field id/name for the tick, so validation errors still bind. */
    checkboxId: string;
    checkboxName: string;
    error?: string | undefined;
}

export function AgentTermsConsent({ terms, checkboxId, checkboxName, error }: Props) {
    if (!terms) {
        // Nothing published, so there is nothing to accept and signup is closed
        // (review). No tick is offered: a checkbox against an absent document is
        // exactly the acceptance the gate refuses to record. The server refuses
        // too — this only stops the form pretending otherwise.
        return (
            <Banner tone="warn">
                <span className="font-semibold">{m.auth_agent_terms_unavailable_title()}</span>
                <span className="mt-1 block">{m.auth_agent_terms_unavailable_body()}</span>
            </Banner>
        );
    }

    return (
        <>
            <div
                id="agent-terms-body"
                tabIndex={0}
                role="region"
                aria-label={m.auth_agent_terms_label()}
                className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-ih-border bg-ih-bg-muted p-4 text-[13px] leading-relaxed text-ih-fg-2 whitespace-pre-wrap focus:shadow-ih-focus"
            >
                {terms.body}
            </div>
            <p className="mt-1.5 text-[12px] text-ih-fg-3">
                {m.auth_agent_terms_version({ version: terms.version })}
            </p>
            {/*
              Round-trips what was rendered so the server can refuse a page left
              open across a publish. NEVER the recorded evidence — the server
              records the hash it read itself, because a client-supplied hash is
              the client asserting what it read, which is what the record exists
              to replace.
            */}
            <input type="hidden" name="shownContentHash" value={terms.contentHash} />
            <label className="mt-3 flex items-start gap-2.5 cursor-pointer">
                <input
                    type="checkbox"
                    id={checkboxId}
                    name={checkboxName}
                    aria-invalid={error ? true : undefined}
                    className="mt-0.5 w-4 h-4 shrink-0 rounded border-ih-border text-ih-primary focus:shadow-ih-focus"
                />
                <span className="text-[13px] text-ih-fg-2 leading-relaxed">
                    {m.auth_agent_terms_label()}
                </span>
            </label>
            {error && <p className="mt-1.5 text-[13px] text-ih-bad-fg">{error}</p>}
        </>
    );
}
