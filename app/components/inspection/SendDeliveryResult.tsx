import type { PersonRow } from "./PeopleEditor";
import type { DeliveryOutcome } from "~/lib/inspector-portal-actions";
import { deliveryReasonText } from "~/lib/communication-view";
import { m } from "~/paraglide/messages";

/**
 * What a send did, when it did not reach everyone: how many were reached and, for each person who was
 * not, who they are and why in words. A person is found by the contact id the route echoes back; one it
 * cannot place is shown as "A recipient" rather than by an id.
 */
export function SendDeliveryResult({ delivery, people }: { delivery: DeliveryOutcome; people: PersonRow[] }) {
  const nameOf = (recipient: string) =>
    people.find((p) => p.contactId === recipient || p.email === recipient)?.name ?? m.inspections_hub_send_result_someone();
  return (
    <div className="space-y-3" data-testid="send-delivery-result">
      <p className="text-[13px] font-semibold text-ih-fg-1">
        {delivery.sent === 0 ? m.inspections_hub_send_result_none() : m.inspections_hub_send_result_summary({ sent: delivery.sent, total: delivery.sent + delivery.skipped.length })}
      </p>
      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-ih-fg-3">{m.inspections_hub_send_result_not_reached()}</p>
      <ul className="space-y-2">
        {delivery.skipped.map((s, i) => (
          <li key={`${s.recipient}-${i}`} className="text-[13px]">
            <span className="font-medium text-ih-fg-1">{nameOf(s.recipient)}</span>
            <span className="block text-[12px] text-ih-bad-fg">{deliveryReasonText(s.reason, s.outcome)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
