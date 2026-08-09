import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { Card, Pill, Button, Modal } from "@core/shared-ui";
import type { action } from "~/routes/inspector-portal";
import type { RoleProfile } from "~/components/contacts/contacts-helpers";
import { AddPersonModal } from "./AddPersonModal";
import { BlockHeading } from "~/components/inspector-portal/BlockHeading";
import { LinkExpiryControl } from "./LinkExpiryControl";
import { PRIMARY_CLIENT_KEY } from "../../../server/lib/people/default-role-profiles";
import { isSoleClient } from "../../../server/lib/people/primary-client";
import type { ReportLinkTtl } from "../../../server/lib/report-link-ttl";
import { formatDate } from "~/lib/format";
import { useDisplayLocale, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

/**
 * Plan 1B Task 5 — one contact/role pairing on an inspection. Mirrors
 * `PersonRowSchema` in server/api/inspections/people.ts.
 */
export interface PersonRow {
  id: string;
  contactId: string;
  roleProfileId: string;
  roleKey: string;
  roleLabel: string;
  kind: "client" | "agent" | "other";
  name: string;
  email: string | null;
  phone: string | null;
  agency: string | null;
  /** IA-36 ⑪ — state of this person's report link. Optional so a stale/partial
   *  payload degrades to "no link" instead of crashing the card. */
  access?: {
    status: "not_sent" | "active" | "expired" | "revoked";
    sentAt: number | null;
    expiresAt: number | null;
  };
}

const GROUP_ORDER = ["client", "agent", "other"] as const;

function groupLabel(kind: PersonRow["kind"]): string {
  switch (kind) {
    case "client":
      return m.inspections_hub_people_client();
    case "agent":
      return m.inspections_hub_people_agents();
    case "other":
      return m.inspections_hub_people_other();
  }
}

/**
 * The report link's state, in words (IA-36 ⑪). The card offers link actions per
 * row, so each row has to say what the current link IS — otherwise "reset this
 * link" is a decision made blind.
 */
function AccessLine({
  access,
  locale,
  timeZone,
}: {
  access: PersonRow["access"];
  locale: string;
  timeZone: string;
}) {
  const status = access?.status ?? "not_sent";
  const tone = status === "revoked" || status === "expired" ? "text-ih-bad-fg" : "text-ih-fg-4";
  const sent = access?.sentAt ? formatDate(access.sentAt, { locale, timeZone }) : "";
  const label =
    status === "not_sent"
      ? m.inspections_hub_people_access_not_sent()
      : status === "revoked"
        ? m.inspections_hub_people_access_revoked()
        : status === "expired"
          ? m.inspections_hub_people_access_expired({ date: sent })
          : access?.expiresAt
            ? m.inspections_hub_people_access_active_until({
                date: sent,
                expiry: formatDate(access.expiresAt, { locale, timeZone }),
              })
            : m.inspections_hub_people_access_active({ date: sent });
  return (
    <p className={`text-[11px] mt-0.5 ${tone}`} data-testid={`people-access-${status}`}>
      {label}
    </p>
  );
}

/**
 * Editable People card. Lists every contact/role pairing on the inspection
 * (`inspection_people`), grouped by the role's capability kind.
 *
 * IA-36 shaped the row actions. There are three verbs, not five: Resend (the
 * existing Send report flow — same URL), Reset (rotate this recipient's link),
 * Remove (they left the inspection; the link dies with them). A standalone
 * "revoke but keep them listed" was deliberately not built — nobody stays on an
 * inspection while being forbidden to read its report.
 *
 * The primary client is NOT a fixed seat any more. It is an assignment that
 * moves (`Make primary`), so the row is removable like any other; the only
 * genuine limit — an inspection cannot end up with nobody on the client side —
 * is stated on a disabled button rather than expressed by hiding it.
 */
export function PeopleEditor({
  inspectionId,
  people,
  roleProfiles,
  isAdmin,
}: {
  inspectionId: string;
  people: PersonRow[];
  roleProfiles: RoleProfile[];
  isAdmin: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const locale = useDisplayLocale();
  const timeZone = useDisplayTimeZone();

  // Independent, dedicated fetchers per mutation. Reusing one fetcher across
  // concurrent mutations cancels the in-flight one (RR shared-fetcher-abort),
  // and these are genuinely separate user actions on the same card.
  const addFetcher = useFetcher<typeof action>();
  const removeFetcher = useFetcher<typeof action>();
  const resetFetcher = useFetcher<typeof action>();
  const primaryFetcher = useFetcher<typeof action>();
  const expiryFetcher = useFetcher<typeof action>();

  // IA-133 — `ok` alone is not "a seat was created". The add is idempotent, so
  // re-adding someone already on the inspection returns ok with nothing changed.
  // Closing on that reads as "done", and the modal's own notice had just told the
  // operator that re-adding reissues a revoked report link — so they walked away
  // believing they had restored access they had not. Stay open and say so.
  const addResult = addFetcher.state === "idle" && addFetcher.data?.intent === "person-add"
    ? addFetcher.data
    : null;
  const addAlreadyPresent = addResult?.ok === true && addResult.alreadyPresent === true;
  const addSucceeded = addResult?.ok === true && !addAlreadyPresent;
  useEffect(() => {
    if (modalOpen && addSucceeded) setModalOpen(false);
  }, [modalOpen, addSucceeded]);

  // Removing a person also revokes their report-access link (IA-36 ①), and
  // resetting kills the URL the customer already has. Both are confirmed — a
  // silent side effect on an already-ambiguous button is exactly what the audit
  // flagged.
  const [removeTarget, setRemoveTarget] = useState<PersonRow | null>(null);
  const [resetTarget, setResetTarget] = useState<PersonRow | null>(null);
  const [ttl, setTtl] = useState<ReportLinkTtl>("never");

  function handleRemove(personId: string) {
    removeFetcher.submit({ intent: "person-remove", personId }, { method: "post" });
    setRemoveTarget(null);
  }

  function handleReset(personId: string) {
    resetFetcher.submit({ intent: "person-reset-access", personId }, { method: "post" });
    setResetTarget(null);
  }

  const busy =
    removeFetcher.state !== "idle" ||
    resetFetcher.state !== "idle" ||
    primaryFetcher.state !== "idle";

  const groups = GROUP_ORDER.map((kind) => ({
    kind,
    rows: people.filter((p) => p.kind === kind),
  })).filter((g) => g.rows.length > 0);

  // The expiry control acts on links that ALREADY exist, so it says how many —
  // "Apply" would hide the consequence behind a harmless word.
  const issued = people.filter((p) => (p.access?.status ?? "not_sent") !== "not_sent");
  const issuedCount = issued.length;
  // Applying "never" when nothing has an expiry (or vice-versa) changes
  // nothing. Offering a live button for a no-op teaches people that the button
  // does not mean what it says.
  const expiryWouldChangeNothing = ttl === "never" && issued.every((p) => p.access?.expiresAt == null);
  const expiryLabel =
    ttl === "never"
      ? issuedCount === 1
        ? m.inspections_hub_people_link_expiry_lift_one()
        : m.inspections_hub_people_link_expiry_lift({ count: issuedCount })
      : issuedCount === 1
        ? m.inspections_hub_people_link_expiry_apply_one()
        : m.inspections_hub_people_link_expiry_apply({ count: issuedCount });

  return (
    <Card className="p-5" data-inspection-id={inspectionId}>
      {/* Shared heading, not a hand-copy of its markup — the duplicate is how
          this card's header came to hold a button while every neighbour's held
          a status pill. "Add person" now sits at the bottom with every other
          card's actions, which is also where you add to the end of a list. */}
      <BlockHeading title={m.inspections_hub_block_people()} />

      {groups.length === 0 ? (
        // A half-width card is not a page: the full EmptyState's centred
        // title-over-description block turned an empty card into a tall pane of
        // whitespace beside compact neighbours, and the grid read as broken.
        <p className="text-[12px] text-ih-fg-3">{m.inspections_hub_people_empty_desc()}</p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.kind}>
              <p
                data-testid={`people-group-${group.kind}`}
                className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-3 mb-1"
              >
                {groupLabel(group.kind)}
              </p>
              <div className="space-y-3">
                {group.rows.map((person) => {
                  const isPrimary = person.roleKey === PRIMARY_CLIENT_KEY;
                  const sole = isSoleClient(people, person.id);
                  return (
                    <div key={person.id} className="text-[13px] text-ih-fg-1">
                    <div
                      className="flex items-start justify-between gap-2"
                    >
                      <div>
                        <p className="font-medium inline-flex items-center gap-2 flex-wrap">
                          <Link to={`/contacts/${person.contactId}`} className="hover:text-ih-primary hover:underline">
                            {person.name}
                          </Link>
                          {isPrimary ? (
                            <Pill tone="primary">{m.inspections_hub_people_primary()}</Pill>
                          ) : (
                            <span className="text-ih-fg-3 font-normal text-[11px]">{person.roleLabel}</span>
                          )}
                        </p>
                        {person.agency && <p className="text-ih-fg-3 text-[12px]">{person.agency}</p>}
                        {person.email && (
                          // IA-36 ⑭ — mailto: is kept and labelled (it leaves the
                          // product for a local mail app, bypassing templates,
                          // delivery records and the tokenized link — the
                          // in-product path is Send report / Reset), but it is no
                          // longer the ONLY way to get the address out.
                          //
                          // On a machine with no mail client registered, clicking
                          // mailto: does nothing at all: no error, no new window.
                          // That is the same failure mode this batch removed from
                          // "Reset access link" — a control whose only outcome is
                          // silence. Copy always works, so the address is always
                          // obtainable regardless of desktop configuration.
                          <span className="flex items-center gap-1.5">
                            <a
                              href={`mailto:${person.email}`}
                              title={m.inspections_hub_people_mailto_hint()}
                              className="text-ih-primary hover:underline"
                            >
                              {person.email}
                            </a>
                            <CopyEmailButton email={person.email} />
                          </span>
                        )}
                        {person.phone && (
                          <a href={`tel:${person.phone}`} className="text-ih-primary hover:underline block">
                            {person.phone}
                          </a>
                        )}
                        <AccessLine access={person.access} locale={locale} timeZone={timeZone} />
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {person.kind === "client" && !isPrimary && (
                          <button
                            type="button"
                            onClick={() =>
                              primaryFetcher.submit(
                                { intent: "person-make-primary", personId: person.id },
                                { method: "post" },
                              )
                            }
                            disabled={busy}
                            className="text-[11px] font-bold text-ih-primary hover:underline disabled:opacity-60"
                          >
                            {m.inspections_hub_people_make_primary()}
                          </button>
                        )}
                        {/* Only offered once a link EXISTS. Reviewing the real
                            card caught this: a person who has never been sent
                            anything was still offered "Reset access link", and
                            the endpoint answers 404 — a control that can only
                            fail is worse than no control. */}
                        {person.email && (person.access?.status ?? "not_sent") !== "not_sent" && (
                          <button
                            type="button"
                            onClick={() => setResetTarget(person)}
                            disabled={busy}
                            className="text-[11px] font-bold text-ih-fg-2 hover:underline disabled:opacity-60"
                          >
                            {m.inspections_hub_people_reset()}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setRemoveTarget(person)}
                          disabled={busy || sole}
                          title={sole ? m.inspections_hub_people_remove_sole_reason() : undefined}
                          className={`text-[11px] font-bold disabled:opacity-50 disabled:cursor-not-allowed ${
                            sole ? "text-ih-fg-4" : "text-ih-bad-fg hover:underline"
                          }`}
                        >
                          {m.inspections_hub_people_remove()}
                        </button>
                      </div>
                    </div>
                    {/* Why the action above is unavailable, on its own line
                        rather than wrapped into the action column — a reason
                        crammed under a red button reads as a validation error
                        about something the operator just did wrong. */}
                    {sole && (
                      <p className="text-[11px] text-ih-fg-3 mt-1">
                        {m.inspections_hub_people_remove_sole_reason()}
                      </p>
                    )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* This card's action, in the one place every hub card puts its actions. */}
      <div className="mt-4">
        <Button variant="secondary" size="sm" onClick={() => setModalOpen(true)}>
          {m.inspections_hub_people_add()}
        </Button>
      </div>

      {/* IA-36 ⑦ — the same control as Settings → Inspection, applied here to the
          links this inspection has already sent. The company-wide policy only
          ever governs links minted after it changes; this is the deliberate,
          self-describing way to act on the ones already out there. */}
      {issuedCount > 0 && (
        <div className="mt-5 pt-4 border-t border-ih-line">
          <h3 className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-ih-fg-3 mb-1">
            {m.inspections_hub_people_link_expiry_heading()}
          </h3>
          <p className="text-[12px] text-ih-fg-3 mb-2">{m.inspections_hub_people_link_expiry_help()}</p>
          <LinkExpiryControl value={ttl} onChange={setTtl} idPrefix="inspection-link-expiry" />
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            disabled={expiryFetcher.state !== "idle" || expiryWouldChangeNothing}
            onClick={() =>
              expiryFetcher.submit(
                { intent: "report-link-expiry", ttl: JSON.stringify(ttl) },
                { method: "post" },
              )
            }
          >
            {expiryLabel}
          </Button>
          {expiryWouldChangeNothing && (
            <p className="text-[11px] text-ih-fg-3 mt-1">{m.inspections_hub_people_link_expiry_noop()}</p>
          )}
        </div>
      )}

      <AddPersonModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        roleProfiles={roleProfiles}
        isAdmin={isAdmin}
        fetcher={addFetcher}
        alreadyPresent={addAlreadyPresent}
      />

      <Modal
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title={m.inspections_hub_people_remove_title()}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>{m.common_cancel()}</Button>
            <Button
              variant="danger"
              disabled={removeFetcher.state !== "idle"}
              onClick={() => removeTarget && handleRemove(removeTarget.id)}
            >{m.inspections_hub_people_remove_cta()}</Button>
          </>
        }
      >
        <p className="text-[13px] text-ih-fg-3">
          {m.inspections_hub_people_remove_confirm({ name: removeTarget?.name ?? "" })}
        </p>
      </Modal>

      <Modal
        open={resetTarget !== null}
        onClose={() => setResetTarget(null)}
        title={m.inspections_hub_people_reset_title()}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetTarget(null)}>{m.common_cancel()}</Button>
            <Button
              variant="danger"
              disabled={resetFetcher.state !== "idle"}
              onClick={() => resetTarget && handleReset(resetTarget.id)}
            >{m.inspections_hub_people_reset_cta()}</Button>
          </>
        }
      >
        {/* IA-134 — the copy assumed the recipient is holding a WORKING link,
            and this control is offered on rows whose access is already revoked
            or expired. In that state the operation is not destruction at all —
            it is the way BACK, and the only way back, since report tokens are
            unique per (inspection, recipient) and re-adding someone reissues
            nothing (IA-133). Describing it as "their link stops working" in the
            one case where they have no working link is precisely backwards. */}
        <p className="text-[13px] text-ih-fg-3">
          {(resetTarget?.access?.status ?? "not_sent") === "active"
            ? m.inspections_hub_people_reset_confirm({ name: resetTarget?.name ?? "" })
            : m.inspections_hub_people_reset_confirm_restore({ name: resetTarget?.name ?? "" })}
        </p>
      </Modal>
    </Card>
  );
}

/**
 * IA-36 ⑭ — copy a contact's address to the clipboard.
 *
 * Sits beside the `mailto:` link rather than replacing it. Both are wanted:
 * `mailto:` is one click for the (many) inspectors who do have a mail client
 * wired up, and copy is the fallback that cannot silently do nothing.
 *
 * Deliberately quiet — an icon-sized text button, not a second primary action.
 * The contact card is a reference surface; the actions that matter (Send
 * report, Reset access link) live in the right-hand column and must stay
 * visually louder than "copy an email address".
 */
function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    void navigator.clipboard?.writeText(email).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      // Announce the address so screen-reader users get "Copy amy@realty.com"
      // rather than a row of identical unlabelled "Copy" buttons.
      aria-label={m.inspections_hub_people_copy_email_aria({ email })}
      className="text-[11px] font-bold text-ih-fg-3 hover:text-ih-primary shrink-0"
    >
      {copied ? m.inspections_hub_copied() : m.inspections_hub_people_copy_email()}
    </button>
  );
}
