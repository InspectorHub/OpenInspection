import { useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Card, Table, Pill, Button, EmptyState, Popover, type PillTone } from "@core/shared-ui";
import { CapabilityMatrix } from "./CapabilityMatrix";
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
  const [matrixOpen, setMatrixOpen] = useState(false);
  const matrixAnchor = useRef<HTMLButtonElement>(null);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-end gap-2 p-3 border-b border-ih-border">
        <button
          ref={matrixAnchor}
          type="button"
          aria-label={m.contacts_roles_matrix_open_aria()}
          onClick={() => setMatrixOpen((v) => !v)}
          className="h-7 w-7 rounded-full border border-ih-border text-ih-fg-3 text-sm font-semibold hover:text-ih-fg-1 hover:border-ih-border-strong transition-colors"
        >
          ?
        </button>
        <Popover open={matrixOpen} onClose={() => setMatrixOpen(false)} anchorRef={matrixAnchor}>
          <div className="p-3">
            <CapabilityMatrix roles={roleProfiles} />
          </div>
        </Popover>
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
            // IA-128 — this said "Delete" and did not delete. The endpoint is a
            // SOFT delete (`server/api/role-profiles.ts`: "Soft-deletes … by
            // setting active:false", responding `{ deactivated: true }`), so the
            // row stayed put with its status flipped to Inactive and the same
            // red "Delete" beside it. Clicking again did nothing at all, and
            // nothing anywhere sent `active: true`, so a custom role was stuck
            // Inactive forever — a one-way door wearing the most destructive
            // word in the UI. The server was honest; the label was not.
            cell: (p) =>
              p.isSystem ? null : (
                <deleteFetcher.Form
                  method="post"
                  className="inline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input type="hidden" name="intent" value={p.active ? "role-deactivate" : "role-reactivate"} />
                  <input type="hidden" name="id" value={p.id} />
                  <button
                    type="submit"
                    className={`text-[12px] font-bold hover:underline ${p.active ? "text-ih-bad-fg" : "text-ih-primary"}`}
                  >
                    {p.active ? m.contacts_roles_action_deactivate() : m.contacts_roles_action_reactivate()}
                  </button>
                </deleteFetcher.Form>
              ),
          },
        ]}
      />
    </Card>
  );
}
