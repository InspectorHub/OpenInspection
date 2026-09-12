import { Link } from "react-router";
import { Card, Pill, EmptyState, Table } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { Contact } from "./contacts-helpers";

export function ContactsTable({
  filtered,
  onEdit,
  onArchive,
  onRestore,
  archivedView = false,
}: {
  filtered: Contact[];
  onEdit: (c: Contact) => void;
  onArchive: (c: Contact) => void;
  /** IA-120 — the way back out of the archive. */
  onRestore?: (c: Contact) => void;
  /** Rendering the archived list: the row verbs change with it. */
  archivedView?: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <Table<Contact>
        rows={filtered}
        getRowKey={(c) => c.id}
        // The archived view needs its own empty copy: "Add one above to get
        // started" is advice for the LIVE list, and reads as a non-sequitur
        // when what you are looking at is an empty archive.
        empty={
          archivedView ? (
            <EmptyState title={m.contacts_archived_empty_title()} description={m.contacts_archived_empty_desc()} />
          ) : (
            <EmptyState title={m.contacts_table_empty_title()} description={m.contacts_table_empty_desc()} />
          )
        }
        columns={[
          {
            label: m.contacts_table_col_name(),
            cell: (c) => (
              <Link to={`/contacts/${c.id}`} className="font-medium text-ih-fg-1 hover:text-ih-primary-text hover:underline">
                {c.name}
              </Link>
            ),
          },
          { label: m.contacts_modal_type_label(), cell: (c) => <Pill tone="info">{c.type}</Pill> },
          // F30/F35 — eight columns of contact data need ~1038px, and the
          // content area beside the sidebar is ~928px at a 1232px viewport, so
          // this table grew a scrollbar on an ordinary laptop and was roughly
          // twice the viewport at 390px. Four columns are identity and verbs
          // and always render; the other four are secondary and appear as the
          // TABLE's own width allows (container queries, not viewport
          // breakpoints — the viewport was never the box that ran out of room).
          // Nothing becomes unreachable: every field is on the contact's own
          // page, which the name in column one links to.
          //
          // `wrap-anywhere` on the email column is the other half. An address
          // is a single unbroken word, so its min-content width — ~170px for a
          // normal one — was a floor under the whole table that no amount of
          // column-dropping could get below.
          { label: m.contacts_field_email(), className: "wrap-anywhere", cell: (c) => <span className="text-ih-fg-3">{c.email || "—"}</span> },
          { label: m.contacts_field_phone(), className: "hidden @2xl:table-cell", cell: (c) => <span className="text-ih-fg-3">{c.phone || "—"}</span> },
          { label: m.contacts_field_agency(), className: "hidden @4xl:table-cell", cell: (c) => <span className="text-ih-fg-3">{c.agency || "—"}</span> },
          { label: m.contacts_field_inspections(), className: "hidden @5xl:table-cell", cell: (c) => <span className="text-ih-fg-3">{c.inspectionCount ?? 0}</span> },
          {
            // IA-96 — this column is the one thing the retired Agents tab
            // showed that this table did not. Both counts are already
            // computed for EVERY contact by the same query (all-role
            // participation vs. buyer-agent referrals), so carrying it here
            // costs nothing and removes the only reason for a second table.
            //
            // A dash means "this metric does not apply to this contact", and a
            // zero means "it applies and the answer is none". Referrals only
            // apply to agents, so a client gets the dash.
            //
            // IA-121 — this used to key the dash on the VALUE being falsy
            // (`c.referralCount ? … : "—"`), which erased the one reading that
            // matters: an AGENT with zero referrals is a real, actionable zero,
            // and it was being displayed as "not applicable". The distinction
            // has to come from the contact, not from the number.
            label: m.contacts_agents_col_referrals(),
            className: "hidden @5xl:table-cell",
            cell: (c) => (
              <span className="text-ih-fg-3 tabular-nums">
                {c.type === "agent" ? (c.referralCount ?? 0) : "—"}
              </span>
            ),
          },
          {
            label: <span className="sr-only">{m.contacts_table_col_actions()}</span>,
            align: "right",
            cell: (c) =>
              archivedView ? (
                // An archived contact offers exactly one verb. Editing one
                // would be editing a record nobody can reach from the live
                // list, and archiving it again is a no-op.
                <button onClick={() => onRestore?.(c)} className="text-ih-primary-text text-[12px] font-bold hover:underline">{m.contacts_action_restore()}</button>
              ) : (
                <>
                  <button onClick={() => onEdit(c)} className="text-ih-primary-text text-[12px] font-bold hover:underline mr-3">{m.common_edit()}</button>
                  <button onClick={() => onArchive(c)} className="text-ih-fg-3 text-[12px] font-bold hover:text-ih-fg-1 hover:underline">{m.contacts_action_archive()}</button>
                </>
              ),
          },
        ]}
      />
    </Card>
  );
}
