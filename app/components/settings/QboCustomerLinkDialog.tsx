import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, useActionLatch } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/** One QuickBooks customer as the picker shows it. No Intuit internals reach the browser. */
export interface CustomerSearchRow {
  id: string;
  displayName: string;
  companyName: string | null;
  email: string | null;
  /** The contact that already holds this customer, if any. */
  linkedContactId: string | null;
  linkedContactName: string | null;
}

export type CustomerSearchFailure = "rate_limited" | "not_connected" | "other";

export type CustomerLinkResult =
  | { ok: true; displayName: string }
  | {
      ok: false;
      reason: "taken" | "inactive" | "not_connected" | "other";
      /** Who holds the customer, when the reason is `taken`. */
      holderName?: string;
      /** The holder is archived: a match survives archiving, so it must be removed from that contact's page. */
      holderArchived?: boolean;
    };

const MIN_QUERY = 2;

function failureText(f: Extract<CustomerLinkResult, { ok: false }>): string {
  switch (f.reason) {
    case "taken": {
      const contact = f.holderName || m.settings_qbo_match_taken_unnamed();
      return f.holderArchived
        ? m.settings_qbo_match_error_taken_archived({ contact })
        : m.settings_qbo_match_error_taken({ contact });
    }
    case "inactive": return m.settings_qbo_match_error_inactive();
    case "not_connected": return m.settings_qbo_match_error_not_connected();
    default: return m.settings_qbo_match_error_other();
  }
}

function searchFailureText(f: CustomerSearchFailure): string {
  if (f === "rate_limited") return m.settings_qbo_match_search_rate_limited();
  if (f === "not_connected") return m.settings_qbo_match_search_not_connected();
  return m.settings_qbo_match_search_failed();
}

/**
 * Matches one contact to an existing QuickBooks customer.
 *
 * The caller injects `search` and `link`, so this component never fetches and
 * the same dialog serves the books-health panel and the contact page.
 *
 * Searching is an explicit submit (Enter or the Search button), not as-you-type:
 * every search is a call to Intuit under the company's credentials and the
 * shared rate limit is small, so a search per keystroke would hit it at once.
 * A rate-limited answer is shown where the list is and leaves the previous
 * results in place.
 */
export function QboCustomerLinkDialog({
  open,
  contact,
  currentLink,
  onClose,
  onLinked,
  search,
  link,
}: {
  open: boolean;
  contact: { id: string; name: string };
  currentLink: { qboCustomerId: string; displayName: string | null } | null;
  onClose: () => void;
  onLinked: (result: { qboCustomerId: string; displayName: string }) => void;
  search: (q: string) => Promise<CustomerSearchRow[] | { error: CustomerSearchFailure }>;
  link: (qboCustomerId: string) => Promise<CustomerLinkResult>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerSearchRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<CustomerSearchFailure | null>(null);
  const [selected, setSelected] = useState<CustomerSearchRow | null>(null);
  const [linking, setLinking] = useState(false);
  const [failure, setFailure] = useState<Extract<CustomerLinkResult, { ok: false }> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Bumped on close so an answer that arrives afterwards cannot repopulate a dialog that was reset.
  const generation = useRef(0);

  const searchLatch = useActionLatch(searching);
  const linkLatch = useActionLatch(linking);

  useEffect(() => {
    if (open) return;
    generation.current += 1;
    setQuery("");
    setResults(null);
    setSearching(false);
    setSearchError(null);
    setSelected(null);
    setLinking(false);
    setFailure(null);
  }, [open]);

  const trimmed = query.trim();
  const tooShort = trimmed.length < MIN_QUERY;

  async function runSearch() {
    const mine = generation.current;
    setSearching(true);
    setSearchError(null);
    const answer = await search(trimmed);
    if (mine !== generation.current) return;
    setSearching(false);
    if (Array.isArray(answer)) setResults(answer);
    else setSearchError(answer.error);
  }

  async function runLink(row: CustomerSearchRow) {
    const mine = generation.current;
    setLinking(true);
    setFailure(null);
    const answer = await link(row.id);
    if (mine !== generation.current) return;
    setLinking(false);
    if (answer.ok) onLinked({ qboCustomerId: row.id, displayName: answer.displayName });
    else setFailure(answer);
  }

  const confirming = selected !== null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={m.settings_qbo_match_title()}
      size="lg"
      initialFocusRef={inputRef}
      footer={
        confirming ? (
          <>
            <Button variant="secondary" pending={linking} onClick={() => { setSelected(null); setFailure(null); }}>
              {m.settings_qbo_match_back()}
            </Button>
            <Button variant="primary" pending={linking} onClick={() => linkLatch(() => { void runLink(selected); })}>
              {linking ? m.settings_qbo_match_saving() : m.settings_qbo_match_confirm_action()}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>{m.common_cancel()}</Button>
        )
      }
    >
      {confirming ? (
        <div className="space-y-3">
          <h3 className="text-[14px] font-bold text-ih-fg-1">
            {m.settings_qbo_match_confirm_heading({ contact: contact.name, customer: selected.displayName })}
          </h3>
          <p className="text-[13px] text-ih-fg-2">{m.settings_qbo_match_confirm_effect()}</p>
          {failure && (
            <p role="alert" className="rounded-md bg-ih-bad-bg px-3 py-2.5 text-[13px] text-ih-bad-fg">
              {failureText(failure)}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-ih-fg-2">{m.settings_qbo_match_intro({ contact: contact.name })}</p>
          {currentLink && (
            <p className="rounded-md bg-ih-watch-bg px-3 py-2.5 text-[13px] text-ih-watch-fg">
              {m.settings_qbo_match_current({
                customer: currentLink.displayName ?? m.settings_qbo_match_current_unnamed(),
              })}
            </p>
          )}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (tooShort) return;
              searchLatch(() => { void runSearch(); });
            }}
          >
            <div className="min-w-0 flex-1">
              <Input
                ref={inputRef}
                id="qbo-match-search"
                type="search"
                label={m.settings_qbo_match_search_label()}
                hint={m.settings_qbo_match_search_hint()}
                maxLength={100}
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button type="submit" variant="primary" pending={searching} disabled={tooShort} className="mb-6">
              {searching ? m.settings_qbo_match_searching() : m.settings_qbo_match_search_button()}
            </Button>
          </form>

          {searchError && (
            <p role="alert" className="rounded-md bg-ih-bad-bg px-3 py-2.5 text-[13px] text-ih-bad-fg">
              {searchFailureText(searchError)}
            </p>
          )}

          {results && results.length === 0 && !searchError && (
            <p className="text-[13px] text-ih-fg-3">{m.settings_qbo_match_none()}</p>
          )}
          {results && results.length > 0 && (
            <ul aria-label={m.settings_qbo_match_results_label()} className="divide-y divide-ih-border rounded-lg border border-ih-border">
              {results.map((row) => {
                const holder = row.linkedContactId !== null || row.linkedContactName !== null;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      disabled={holder}
                      onClick={() => { setSelected(row); setFailure(null); }}
                      className={`block w-full px-3 py-2.5 text-left ${
                        holder ? "cursor-not-allowed bg-ih-bg-muted text-ih-fg-4" : "text-ih-fg-1 hover:bg-ih-bg-muted"
                      }`}
                    >
                      <span className="block text-[13px] font-bold">{row.displayName}</span>
                      {(row.companyName || row.email) && (
                        <span className="block text-[12px]">
                          {[row.companyName, row.email].filter(Boolean).join(" · ")}
                        </span>
                      )}
                      {holder && (
                        <span className="block text-[12px]">
                          {m.settings_qbo_match_taken_row({
                            contact: row.linkedContactName || m.settings_qbo_match_taken_unnamed(),
                          })}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
