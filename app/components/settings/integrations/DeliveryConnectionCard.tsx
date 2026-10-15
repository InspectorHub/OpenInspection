import { Card, Pill, type PillTone } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { sourceText } from "./source-text";
import type { IntegrationSource } from "../../../../server/lib/integrations/sources";
import type { SourceReasonMessageKey } from "../../../../server/lib/integrations/source-reasons";

type Status = "connected" | "attention" | "not_connected";

const STATUS: Record<Status, { tone: PillTone; label: () => string }> = {
  connected: { tone: "sat", label: () => m.settings_conn_status_connected() },
  attention: { tone: "warning", label: () => m.integrations_hub_status_attention() },
  not_connected: { tone: "neutral", label: () => m.integrations_hub_status_not_connected() },
};

/**
 * The connection card at the top of a service page: what the service is, whether
 * it is working, and whose account it runs on. Status and source are two separate
 * facts and are drawn as two separate things.
 */
export function DeliveryConnectionCard({
  title,
  description,
  status,
  source,
  reasonKey,
}: {
  title: string;
  description: string;
  status: Status;
  source: IntegrationSource;
  reasonKey: SourceReasonMessageKey | null;
}) {
  const pill = STATUS[status];
  return (
    <Card className="p-5 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-bold text-ih-fg-1">{title}</h2>
        <span data-testid="delivery-status" className="shrink-0">
          <Pill tone={pill.tone}>{pill.label()}</Pill>
        </span>
      </div>
      <p className="text-xs text-ih-fg-3">{description}</p>
      <p data-testid="delivery-source" className="text-xs font-bold text-ih-fg-2">{sourceText(source, reasonKey, title)}</p>
    </Card>
  );
}
