import { useEffect, useState } from "react";
import type { useFetcher } from "react-router";
import { Modal, Button, Checkbox } from "@core/shared-ui";
import type { action } from "~/routes/inspector-portal";
import type { PersonRow } from "./PeopleEditor";
import { m } from "~/paraglide/messages";

const FORM_ID = "ih-send-sms-form";

/**
 * Manual SMS modal (Communication A3.4). People already on the inspection who
 * have a phone — no free-typed numbers (nowhere to record their consent). A
 * phoneless person is shown disabled with a reason, mirroring SendReportModal's
 * no-email treatment.
 */
export function SendSmsModal({
  people,
  fetcher,
  onClose,
}: {
  people: PersonRow[];
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  onClose: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggle(personId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }

  const recipients = people
    .filter((p) => selectedIds.has(p.id) && p.phone)
    .map((p) => ({ contactId: p.contactId, roleKey: p.roleKey }));

  const submitting = fetcher.state !== "idle";
  const error =
    fetcher.data?.intent === "send-sms" && "ok" in fetcher.data && !fetcher.data.ok
      ? fetcher.data.error
      : undefined;

  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.intent === "send-sms" &&
      "ok" in fetcher.data &&
      fetcher.data.ok
    ) {
      onClose();
    }
  }, [fetcher.state, fetcher.data, onClose]);

  const byKind = (["client", "agent", "other"] as const).map((kind) => ({
    kind,
    rows: people.filter((p) => p.kind === kind),
  })).filter((g) => g.rows.length > 0);

  function groupLabel(kind: PersonRow["kind"]): string {
    switch (kind) {
      case "client": return m.inspections_hub_people_client();
      case "agent": return m.inspections_hub_people_agents();
      case "other": return m.inspections_hub_people_other();
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={m.inspections_hub_send_sms_title()}
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose} disabled={submitting}>
            {m.common_cancel()}
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form={FORM_ID}
            disabled={submitting || recipients.length === 0}
          >
            {submitting ? m.inspections_hub_send_sms_sending() : m.inspections_hub_send_sms_submit()}
          </Button>
        </div>
      }
    >
      <fetcher.Form method="post" id={FORM_ID} className="space-y-4">
        <input type="hidden" name="intent" value="send-sms" />
        <input type="hidden" name="recipients" value={JSON.stringify(recipients)} />
        <p className="text-[12px] text-ih-fg-3">{m.inspections_hub_send_sms_hint()}</p>
        {byKind.map(({ kind, rows }) => (
          <div key={kind}>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-ih-fg-3 mb-1.5">
              {groupLabel(kind)}
            </p>
            <ul className="space-y-1">
              {rows.map((person) => {
                const inputId = `send-sms-person-${person.id}`;
                const disabled = !person.phone;
                return (
                  <li key={person.id} className="flex items-center gap-2 min-h-8">
                          <Checkbox
                            bare
                            id={inputId}
                            data-testid={inputId}
                            checked={selectedIds.has(person.id)}
                            disabled={disabled || submitting}
                            onChange={() => toggle(person.id)}
                            className="mt-0.5"
                          />
                    <label htmlFor={inputId} className={`text-[13px] ${disabled ? "text-ih-fg-4" : "text-ih-fg-1"}`}>
                      <span className="font-medium">{person.name}</span>
                      <span className="text-ih-fg-4"> · {person.roleLabel}</span>
                      {disabled && (
                        <span className="block text-[11px] text-ih-fg-3">
                          {m.inspections_hub_send_sms_no_phone_hint()}
                        </span>
                      )}
                      {!disabled && person.phone && (
                        <span className="block text-[11px] text-ih-fg-3 tabular-nums">{person.phone}</span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {error && <p className="text-[12px] text-ih-danger" role="alert">{error}</p>}
      </fetcher.Form>
    </Modal>
  );
}
