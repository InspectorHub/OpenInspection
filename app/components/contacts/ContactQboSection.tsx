import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { ContactQboCard } from "~/components/contacts/ContactQboCard";
import { useQboMatchDialog } from "~/components/settings/useQboContactMatch";
import type { ContactQbo, ContactQboActionData } from "~/lib/contact-qbo.server";

/**
 * The contact page's QuickBooks card wired to the route's action: matching goes
 * through the shared dialog, removing through a guarded submit. Both end in the
 * action, whose completion revalidates the page, so the card shows the new state.
 */
export function ContactQboSection({
  qbo,
  contact,
}: {
  qbo: ContactQbo;
  contact: { id: string; name: string; archived: boolean };
}) {
  const match = useQboMatchDialog();
  const { fetcher, submit, busy } = useGuardedSubmit<ContactQboActionData>();
  const { link } = qbo;

  const answer = fetcher.data;
  const unlinkFailed = !busy && answer?.intent === "qbo-unlink-customer" && !answer.success;

  return (
    <>
      <ContactQboCard
        connected={qbo.connected}
        link={link}
        archived={contact.archived}
        unlinking={busy}
        unlinkFailed={unlinkFailed}
        onOpenDialog={() =>
          match.open({
            id: contact.id,
            name: contact.name,
            currentLink: link.linked && link.qboCustomerId
              ? { qboCustomerId: link.qboCustomerId, displayName: link.displayName }
              : null,
          })}
        onUnlink={() => { submit({ intent: "qbo-unlink-customer" }, { method: "POST" }); }}
      />
      {match.dialog}
    </>
  );
}
