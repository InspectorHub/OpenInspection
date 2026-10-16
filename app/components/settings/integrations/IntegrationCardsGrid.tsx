import { Link } from "react-router";
import { Card, Pill, buttonClasses, type PillTone } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { sourceText } from "./source-text";
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

function ServiceCard({ card }: { card: IntegrationCard }) {
  const copy = COPY[card.id];
  if (!copy) return null;
  const title = copy.title();
  const status = STATUS[card.status];
  const action = status.action();
  const titleId = `integration-${card.id}-title`;
  const needsAction = card.status !== "connected";
  return (
    <Card className="h-full">
      <article aria-labelledby={titleId} className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex flex-wrap items-baseline gap-x-2">
            <h3 id={titleId} className="text-sm font-bold text-ih-fg-1">{title}</h3>
            {copy.vendor && <span className="text-xs text-ih-fg-3">{copy.vendor()}</span>}
          </div>
          <span data-testid="integration-status" className="shrink-0">
            <Pill tone={status.tone}>{status.label()}</Pill>
          </span>
        </div>
        <p className="text-xs text-ih-fg-3">{copy.desc()}</p>
        <p data-testid="integration-source" className="text-xs font-bold text-ih-fg-2">{sourceText(card.source, card.reasonKey, title, card.dedicatedNumber)}</p>
        <div className="mt-auto pt-1">
          <Link
            to={card.detailPath}
            aria-label={m.integrations_hub_action_label({ action, title })}
            className={buttonClasses({ variant: needsAction ? "primary" : "link", size: "sm" })}
          >
            {action}
          </Link>
        </div>
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
    <div className="space-y-8">
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
          <section key={category} className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ih-fg-3">{CATEGORY_TITLE[category]()}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {inCategory.map((card) => <ServiceCard key={card.id} card={card} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
