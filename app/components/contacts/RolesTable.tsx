import { useFetcher } from "react-router";
import { Card, Table, Pill, Button, EmptyState, type PillTone } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { RoleProfile } from "./contacts-helpers";

const KIND_TONE: Record<RoleProfile["kind"], PillTone> = {
  client: "info",
  agent: "primary",
  other: "neutral",
};

const KIND_LABEL: Record<RoleProfile["kind"], () => string> = {
  client: () => m.contacts_roles_kind_client(),
  agent: () => m.contacts_roles_kind_agent(),
  other: () => m.contacts_roles_kind_other(),
};

/**
 * Admin-only Roles tab table (`/contacts` → Roles). Lists tenant role
 * profiles (system + tenant-defined). System profiles (`isSystem`, seeded by
 * `seedRoleProfiles`) are never deletable — the delete action is hidden for
 * those rows, mirroring the 409 the server itself returns for that path (see
 * server/api/role-profiles.ts). Clicking any row opens the edit modal; the
 * kind is immutable once created so the modal disables that field for edits.
 */
export function RolesTable({
  roleProfiles,
  onEdit,
  onCreate,
}: {
  roleProfiles: RoleProfile[];
  onEdit: (profile: RoleProfile) => void;
  onCreate: () => void;
}) {
  const deleteFetcher = useFetcher();

  return (
    <Card className="overflow-hidden">
      <div className="flex justify-end p-3 border-b border-ih-border">
        <Button variant="primary" size="sm" onClick={onCreate}>
          {m.contacts_roles_action_add()}
        </Button>
      </div>
      <Table<RoleProfile>
        rows={roleProfiles}
        getRowKey={(p) => p.id}
        onRowClick={(p) => onEdit(p)}
        empty={<EmptyState title={m.contacts_roles_empty_title()} />}
        columns={[
          {
            label: m.contacts_roles_col_label(),
            cell: (p) => (
              <span className="font-medium text-ih-fg-1 inline-flex items-center gap-2">
                {p.label}
                {p.isSystem && <Pill tone="neutral">{m.contacts_roles_system_pill()}</Pill>}
              </span>
            ),
          },
          { label: m.contacts_roles_col_kind(), cell: (p) => <Pill tone={KIND_TONE[p.kind]}>{KIND_LABEL[p.kind]()}</Pill> },
          {
            label: m.contacts_roles_col_status(),
            cell: (p) => (
              <Pill tone={p.active ? "sat" : "monitor"}>
                {p.active ? m.contacts_roles_status_active() : m.contacts_roles_status_inactive()}
              </Pill>
            ),
          },
          {
            label: <span className="sr-only">{m.contacts_table_col_actions()}</span>,
            align: "right",
            cell: (p) =>
              p.isSystem ? null : (
                <deleteFetcher.Form
                  method="post"
                  className="inline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input type="hidden" name="intent" value="role-delete" />
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" className="text-ih-bad-fg text-[12px] font-bold hover:underline">
                    {m.common_delete()}
                  </button>
                </deleteFetcher.Form>
              ),
          },
        ]}
      />
    </Card>
  );
}
