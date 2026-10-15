import { Link } from "react-router";
import { Card, Pill, buttonClasses, type PillTone } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { IntegrationCard, IntegrationCategory, IntegrationStatus } from "../../../../server/lib/integrations/overview";

/** The order the page groups cards in. */
const CATEGORY_ORDER: readonly IntegrationCategory[] = ["payments", "accounting", "calendar", "messaging", "data", "video", "ai"];

const CATEGORY_TITLE: Record<IntegrationCategory, () => string> = {
  payments: () => m.integrations_hub_cat_payments(),
  accounting: () => m.integrations_hub_cat_accounting(),
  calendar: () => m.integrations_hub_cat_calendar(),
  messaging: () => m.integrations_hub_cat_messaging(),
  data: () => m.integrations_hub_cat_data(),
  video: () => m.integrations_hub_cat_video(),
  ai: () => m.integrations_hub_cat_ai(),
};

/** What each service is called and does. The title says the job; the vendor, where there is one fixed vendor, sits under it. */
const COPY: Record<string, { title: () => string; vendor?: () => string; desc: () => string }> = {
  stripe: { title: () => m.integrations_hub_stripe_title(), vendor: () => m.integrations_hub_stripe_vendor(), desc: () => m.integrations_hub_stripe_desc() },
  quickbooks: { title: () => m.integrations_hub_quickbooks_title(), vendor: () => m.integrations_hub_quickbooks_vendor(), desc: () => m.integrations_hub_quickbooks_desc() },
  googleCalendar: { title: () => m.integrations_hub_googleCalendar_title(), vendor: () => m.integrations_hub_googleCalendar_vendor(), desc: () => m.integrations_hub_googleCalendar_desc() },
  email: { title: () => m.integrations_hub_email_title(), desc: () => m.integrations_hub_email_desc() },
  sms: { title: () => m.integrations_hub_sms_title(), desc: () => m.integrations_hub_sms_desc() },
  places: { title: () => m.integrations_hub_places_title(), vendor: () => m.integrations_hub_places_vendor(), desc: () => m.integrations_hub_places_desc() },
  estated: { title: () => m.integrations_hub_estated_title(), vendor: () => m.integrations_hub_estated_vendor(), desc: () => m.integrations_hub_estated_desc() },
  video: { title: () => m.integrations_hub_video_title(), desc: () => m.integrations_hub_video_desc() },
  ai: { title: () => m.integrations_hub_ai_title(), desc: () => m.integrations_hub_ai_desc() },
};

const STATUS: Record<IntegrationStatus, { tone: PillTone; label: () => string; action: () => string }> = {
  connected: { tone: "sat", label: () => m.settings_conn_status_connected(), action: () => m.integrations_hub_action_manage() },
  attention: { tone: "warning", label: () => m.integrations_hub_status_attention(), action: () => m.integrations_hub_action_review() },
  not_connected: { tone: "neutral", label: () => m.integrations_hub_status_not_connected(), action: () => m.integrations_hub_action_set_up() },
};

/** Whose account, in words. An unavailable source says why when there is a reason to give. */
function sourceText(card: IntegrationCard, title: string): string {
  if (card.source === "provided") return m.integrations_hub_source_provided();
  if (card.source === "own") return m.integrations_hub_source_own();
  switch (card.reasonKey) {
    case "integrations_source_reason_not_offered":
      return m.integrations_source_reason_not_offered({ service: title });
    case "integrations_source_reason_provided_not_configured":
      return m.integrations_source_reason_provided_not_configured({ service: title });
    case "integrations_source_reason_provider_confirmation_pending":
      return m.integrations_source_reason_provider_confirmation_pending();
    // The missing details are named on the service's own page; here the card
    // only says which account it will use once they are added.
    case "integrations_source_reason_own_credentials_incomplete":
      return m.integrations_hub_source_own();
    default:
      return m.integrations_hub_source_unavailable();
  }
}

function ServiceCard({ card }: { card: IntegrationCard }) {
  const copy = COPY[card.id];
  if (!copy) return null;
  const title = copy.title();
  const status = STATUS[card.status];
  const action = status.action();
  const titleId = `integration-${card.id}-title`;
  return (
    <Card className="p-5 flex flex-col gap-3">
      <article aria-labelledby={titleId} className="flex flex-col gap-3 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div aria-hidden="true" className="w-8 h-8 shrink-0 rounded-ih-button bg-ih-bg-muted text-ih-fg-2 flex items-center justify-center text-xs font-bold">
              {title.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h3 id={titleId} className="text-sm font-bold text-ih-fg-1">{title}</h3>
              {copy.vendor && <p className="text-xs text-ih-fg-3">{copy.vendor()}</p>}
            </div>
          </div>
          <span data-testid="integration-status" className="shrink-0">
            <Pill tone={status.tone}>{status.label()}</Pill>
          </span>
        </div>
        <p className="text-xs text-ih-fg-3 flex-1">{copy.desc()}</p>
        <p data-testid="integration-source" className="text-xs font-bold text-ih-fg-2">{sourceText(card, title)}</p>
        <Link
          to={card.detailPath}
          aria-label={m.integrations_hub_action_label({ action, title })}
          className={buttonClasses({ variant: "secondary", size: "sm", className: "self-start" })}
        >
          {action}
        </Link>
      </article>
    </Card>
  );
}

function Summary({ cards }: { cards: IntegrationCard[] }) {
  const count = (status: IntegrationStatus) => cards.filter((c) => c.status === status).length;
  return (
    <div role="group" aria-label={m.integrations_hub_summary_label()} className="flex flex-wrap gap-2">
      <Pill tone="sat">{m.integrations_hub_summary_connected({ count: count("connected") })}</Pill>
      <Pill tone="warning">{m.integrations_hub_summary_attention({ count: count("attention") })}</Pill>
      <Pill tone="neutral">{m.integrations_hub_summary_not_connected({ count: count("not_connected") })}</Pill>
    </div>
  );
}

export function IntegrationCardsGrid({ cards }: { cards: IntegrationCard[] }) {
  if (cards.length === 0) {
    return <p className="text-sm text-ih-fg-3">{m.integrations_hub_empty()}</p>;
  }
  // Built-in only needs explaining where it can occur.
  const hasBuiltIn = cards.some((c) => c.source === "provided" || c.canUseOwn);
  return (
    <div className="space-y-ih-list">
      <Summary cards={cards} />
      <ul className="text-xs text-ih-fg-3 space-y-0.5">
        <li>{m.integrations_hub_legend_status()}</li>
        {hasBuiltIn && <li>{m.integrations_hub_legend_built_in()}</li>}
        <li>{m.integrations_hub_legend_own()}</li>
      </ul>
      {CATEGORY_ORDER.map((category) => {
        const inCategory = cards.filter((c) => c.category === category);
        if (inCategory.length === 0) return null;
        return (
          <section key={category} className="space-y-3">
            <h2 className="text-sm font-bold text-ih-fg-1">{CATEGORY_TITLE[category]()}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {inCategory.map((card) => <ServiceCard key={card.id} card={card} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
