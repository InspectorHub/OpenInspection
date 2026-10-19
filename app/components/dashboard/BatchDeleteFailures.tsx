import { Banner } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/** What the last batch delete could not remove, by address, each with the reason the server gave. */
export function BatchDeleteFailures({ failures, addressOf, onDismiss }: {
    failures: ReadonlyArray<{ id: string; error: string }>;
    addressOf: ReadonlyMap<string, string | null>;
    onDismiss: () => void;
}) {
    if (failures.length === 0) return null;
    return (
        <Banner tone="danger" dismissible onDismiss={onDismiss}>
            <p className="font-semibold">{m.inspections_list_delete_failed()}</p>
            <ul className="mt-1 list-disc pl-5">
                {failures.map((f) => (
                    <li key={f.id}>{m.inspections_list_delete_failed_item({ address: addressOf.get(f.id) || f.id, reason: f.error })}</li>
                ))}
            </ul>
        </Banner>
    );
}
