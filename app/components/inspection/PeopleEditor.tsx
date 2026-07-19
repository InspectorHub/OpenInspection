import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { Card, Pill, Button, EmptyState } from "@core/shared-ui";
import type { action } from "~/routes/inspection-hub";
import type { RoleProfile } from "~/components/contacts/contacts-helpers";
import { AddPersonModal } from "./AddPersonModal";
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
}

// The primary-client role's stable machine key — mirrors PRIMARY_CLIENT_KEY
// in server/lib/people/default-role-profiles.ts. A role profile's `key` and
// `kind` are immutable once created (server/lib/validations/role-profile.schema.ts),
// so this string is a safe cross-layer constant rather than a duplicated import
// of server-only code into the client bundle.
const PRIMARY_CLIENT_ROLE_KEY = "client";

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
 * Editable replacement for the read-only People card (Plan 1B Task 5). Lists
 * every contact/role pairing recorded on the inspection via `inspection_people`
 * (Task 3's `/api/inspections/:id/people`), grouped by the role's capability
 * `kind` (Client / Agents / Other). The primary client (roleKey === "client")
 * is a fixed seat — it shows a "Primary" pill and has no remove control,
 * mirroring the 409 the server itself returns for a second primary client
 * (PeopleService.addPerson).
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

  // Independent, dedicated fetchers for the two people mutations — neither is
  // shared with any OTHER mutation on the hub page (send-agreement /
  // request-payment / publish / submit / ...). Reusing one fetcher across
  // concurrent mutations cancels the in-flight one (RR shared-fetcher-abort).
  const addFetcher = useFetcher<typeof action>();
  const removeFetcher = useFetcher<typeof action>();

  const addSucceeded =
    addFetcher.state === "idle" && addFetcher.data?.intent === "person-add" && addFetcher.data.ok;
  useEffect(() => {
    if (modalOpen && addSucceeded) setModalOpen(false);
  }, [modalOpen, addSucceeded]);

  function handleRemove(personId: string) {
    removeFetcher.submit({ intent: "person-remove", personId }, { method: "post" });
  }

  const groups = GROUP_ORDER.map((kind) => ({
    kind,
    rows: people.filter((p) => p.kind === kind),
  })).filter((g) => g.rows.length > 0);

  return (
    <Card className="p-5" data-inspection-id={inspectionId}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[13px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-3">
          {m.inspections_hub_block_people()}
        </h2>
        <Button variant="secondary" size="sm" onClick={() => setModalOpen(true)}>
          {m.inspections_hub_people_add()}
        </Button>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title={m.inspections_hub_people_empty_title()}
          description={m.inspections_hub_people_empty_desc()}
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.kind}>
              <p
                data-testid={`people-group-${group.kind}`}
                className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-4 mb-1"
              >
                {groupLabel(group.kind)}
              </p>
              <div className="space-y-2">
                {group.rows.map((person) => {
                  const isPrimary = person.roleKey === PRIMARY_CLIENT_ROLE_KEY;
                  return (
                    <div
                      key={person.id}
                      className="flex items-start justify-between gap-2 text-[13px] text-ih-fg-1"
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
                          <a href={`mailto:${person.email}`} className="text-ih-primary hover:underline block">
                            {person.email}
                          </a>
                        )}
                        {person.phone && (
                          <a href={`tel:${person.phone}`} className="text-ih-primary hover:underline block">
                            {person.phone}
                          </a>
                        )}
                      </div>
                      {!isPrimary && (
                        <button
                          type="button"
                          onClick={() => handleRemove(person.id)}
                          disabled={removeFetcher.state !== "idle"}
                          className="text-[11px] font-bold text-ih-bad-fg hover:underline disabled:opacity-60 shrink-0"
                        >
                          {m.inspections_hub_people_remove()}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <AddPersonModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        roleProfiles={roleProfiles}
        isAdmin={isAdmin}
        fetcher={addFetcher}
      />
    </Card>
  );
}
