import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Modal, Button, Checkbox, Input, Select } from "@core/shared-ui";
import type { action } from "~/routes/inspection-hub";
import type { PersonRow } from "./PeopleEditor";
import type { RoleProfile } from "~/components/contacts/contacts-helpers";
import { m } from "~/paraglide/messages";

const FORM_ID = "ih-send-report-form";

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

/** A recipient posted in the hidden `recipients` field — mirrors SendReportRecipient. */
interface Recipient {
  contactId?: string;
  email?: string;
  roleKey: string;
}

/**
 * "Send report" modal (Spec 2 Task 7). Lets the user pick people already on
 * the inspection (grouped by role, mirroring `PeopleEditor`) and/or add a
 * one-off email + role, then posts the picks as `recipients` on the hub
 * action's "send-report" intent → `POST /{id}/send-report-pdf`, which mints
 * each recipient their own role-keyed tokenized report link + PDF.
 *
 * All role `kind`s receive reports today (no `receivesReport:false` kind
 * exists yet), so every person WITH an email is selectable — a person with
 * no email is shown disabled with a hint, since the endpoint would skip them
 * anyway. If a future role profile kind sets `receivesReport:false`, this
 * list should filter people on that capability before rendering them as
 * selectable (see server/lib/people/default-role-profiles.ts once it grows
 * that flag).
 */
export function SendReportModal({
  people,
  roleProfiles,
  fetcher,
  onClose,
}: {
  people: PersonRow[];
  roleProfiles: RoleProfile[];
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  onClose: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [oneOffEmail, setOneOffEmail] = useState("");
  const [oneOffRoleKey, setOneOffRoleKey] = useState("");

  const activeRoles = roleProfiles.filter((r) => r.active);

  function toggle(personId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }

  const peopleRecipients: Recipient[] = people
    .filter((p) => selectedIds.has(p.id) && p.email)
    .map((p) => ({ contactId: p.contactId, roleKey: p.roleKey }));

  const trimmedEmail = oneOffEmail.trim();
  const oneOffRecipient: Recipient[] =
    trimmedEmail && oneOffRoleKey ? [{ email: trimmedEmail, roleKey: oneOffRoleKey }] : [];

  const recipients: Recipient[] = [...peopleRecipients, ...oneOffRecipient];

  const submitting = fetcher.state !== "idle";
  const error =
    fetcher.data?.intent === "send-report" && "ok" in fetcher.data && !fetcher.data.ok
      ? fetcher.data.error
      : undefined;

  // Auto-close on success — read via an effect keyed on the fetcher's settled
  // state, never at render (RoleProfileModal / the hub's useModalFetcher
  // lesson: the render pass that triggers a submission always observes the
  // PREVIOUS result, so a render-time check either closes on a stale result
  // or never closes at all).
  const succeeded =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "send-report" &&
    "ok" in fetcher.data &&
    fetcher.data.ok;
  useEffect(() => {
    if (succeeded) onClose();
  }, [succeeded, onClose]);

  const groups = GROUP_ORDER.map((kind) => ({
    kind,
    rows: people.filter((p) => p.kind === kind),
  })).filter((g) => g.rows.length > 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={m.inspections_hub_send_report_title()}
      size="lg"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            {m.common_cancel()}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={FORM_ID}
            disabled={submitting || recipients.length === 0}
          >
            {submitting ? m.inspections_hub_send_report_sending() : m.inspections_hub_send_report_submit()}
          </Button>
        </>
      }
    >
      <fetcher.Form id={FORM_ID} method="post" className="space-y-4">
        <input type="hidden" name="intent" value="send-report" />
        <input type="hidden" name="recipients" value={JSON.stringify(recipients)} readOnly />
        <input type="hidden" name="channels" value={JSON.stringify(["email"])} readOnly />

        <div>
          <p className="text-xs font-bold text-ih-fg-2 mb-2">
            {m.inspections_hub_send_report_people_label()}
          </p>
          {groups.length === 0 ? (
            <p className="text-[12px] text-ih-fg-4">{m.inspections_hub_people_empty_title()}</p>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group.kind}>
                  <p
                    data-testid={`people-group-${group.kind}`}
                    className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-4 mb-1"
                  >
                    {groupLabel(group.kind)}
                  </p>
                  <div className="space-y-1.5">
                    {group.rows.map((person) => {
                      const hasEmail = !!person.email;
                      const inputId = `send-report-person-${person.id}`;
                      return (
                        <label
                          key={person.id}
                          htmlFor={inputId}
                          className={`flex items-start gap-2.5 text-[13px] ${
                            hasEmail ? "text-ih-fg-1 cursor-pointer" : "text-ih-fg-4 cursor-not-allowed"
                          }`}
                        >
                          <Checkbox
                            bare
                            id={inputId}
                            data-testid={inputId}
                            checked={selectedIds.has(person.id)}
                            disabled={!hasEmail}
                            onChange={() => toggle(person.id)}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="font-medium">{person.name}</span>
                            <span className="text-ih-fg-3 font-normal text-[11px] ml-1.5">
                              {person.roleLabel}
                            </span>
                            <br />
                            {hasEmail ? (
                              <span className="text-ih-fg-3">{person.email}</span>
                            ) : (
                              <span className="text-ih-fg-4 italic">
                                {m.inspections_hub_send_report_no_email_hint()}
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-ih-border">
          <p className="text-xs font-bold text-ih-fg-2 mb-2">
            {m.inspections_hub_send_report_oneoff_title()}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              type="email"
              label={m.inspections_hub_send_report_oneoff_email_label()}
              placeholder={m.inspections_hub_send_report_oneoff_email_ph()}
              value={oneOffEmail}
              onChange={(e) => setOneOffEmail(e.target.value)}
            />
            <Select
              label={m.inspections_hub_send_report_oneoff_role_label()}
              value={oneOffRoleKey}
              onChange={(e) => setOneOffRoleKey(e.target.value)}
              options={[
                { value: "", label: m.inspections_hub_send_report_oneoff_role_placeholder(), disabled: true },
                ...activeRoles.map((r) => ({ value: r.key, label: r.label })),
              ]}
            />
          </div>
        </div>

        {/* Channel — email only for now; the backend endpoint accepts no
            other channel value yet (server/lib/validations/send-report.schema.ts). */}
        <div className="flex items-center gap-2 text-[12px] text-ih-fg-3">
          <span className="font-bold text-ih-fg-2">{m.inspections_hub_send_report_channel_label()}:</span>
          <span>{m.inspections_hub_send_report_channel_email()}</span>
        </div>

        {error && <p className="text-[12px] font-medium text-ih-bad-fg">{error}</p>}
      </fetcher.Form>
    </Modal>
  );
}
