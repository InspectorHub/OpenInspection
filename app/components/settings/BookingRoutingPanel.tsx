import { useState } from "react";
import { useFetcher } from "react-router";
import { Banner, Input, RadioCardGroup } from "@core/shared-ui";
import type { action } from "~/routes/settings-booking";
import { m } from "~/paraglide/messages";

export type RoutingStrategy = "first_available" | "least_loaded" | "closest";

export interface BookingRoutingConfig {
  routingStrategy: RoutingStrategy;
  minLeadHours: number;
  sameDayCutoffTime: string | null;
  companyAddress: string | null;
  companyLat: number | null;
  companyLng: number | null;
  geocodeAvailable: boolean;
  /** Inspectors with their own start address; everyone else inherits the company one. */
  originCount: number;
}

/**
 * Routing strategy + booking rules.
 *
 * The part worth defending: `closest` cannot work without coordinates, and a
 * radio button that silently does nothing is the exact failure this whole
 * change exists to remove. So the readiness of each strategy is stated NEXT TO
 * the option, before it is chosen — and the company geocode is an explicit
 * button with a visible result rather than a side effect of saving an
 * unrelated field.
 *
 * Named `BookingRoutingPanel`, not `BookingRulesPanel`: this page already
 * carries `BookingSlotRulesPanel` and `BookingPoliciesPanel`, and a third
 * "rules" panel would be indistinguishable from both in a file list.
 */
export function BookingRoutingPanel({
  initial,
  anchoredInspectorCount,
}: {
  initial: BookingRoutingConfig;
  /** Inspectors that would have a service origin — company-inherited or their own. */
  anchoredInspectorCount: number;
}) {
  const fetcher = useFetcher<typeof action>();
  const geocodeFetcher = useFetcher<typeof action>();
  const [strategy, setStrategy] = useState<RoutingStrategy>(initial.routingStrategy);
  const [leadHours, setLeadHours] = useState(String(initial.minLeadHours));
  const [cutoff, setCutoff] = useState(initial.sameDayCutoffTime ?? "");
  const [dirty, setDirty] = useState(false);

  const saving = fetcher.state !== "idle";
  const done = fetcher.state === "idle" && fetcher.data?.intent === "routing-save" && !dirty;
  const saved = done && fetcher.data?.ok === true;
  const failed = done && fetcher.data?.ok === false;

  const hasCompanyAnchor = initial.companyLat !== null && initial.companyLng !== null;
  const geocoding = geocodeFetcher.state !== "idle";
  const geocodeResult =
    geocodeFetcher.state === "idle" && geocodeFetcher.data?.intent === "routing-geocode-company"
      ? geocodeFetcher.data
      : null;

  // Why the chosen strategy would NOT run today. Null when it will.
  const blocker: string | null =
    strategy === "closest" && !initial.geocodeAvailable
      ? m.settings_routing_closest_no_places()
      : strategy === "closest" && !hasCompanyAnchor && initial.originCount === 0
        ? m.settings_routing_closest_no_anchor()
        : strategy === "closest" && anchoredInspectorCount < 2
          ? m.settings_routing_closest_one_anchor()
          : null;

  function handleSave() {
    setDirty(false);
    fetcher.submit(
      {
        intent: "routing-save",
        routingStrategy: strategy,
        minLeadHours: String(Math.max(0, Number(leadHours) || 0)),
        sameDayCutoffTime: cutoff,
      },
      { method: "post" },
    );
  }

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-5">
      <div>
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
          {m.settings_routing_heading()}
        </h3>
        <p className="text-[12px] text-ih-fg-3 mt-1">{m.settings_routing_desc()}</p>
      </div>

      <div className="space-y-2">
        <RadioCardGroup
          name="routingStrategy"
          legend={m.settings_routing_strategy_label()}
          value={strategy}
          onChange={(v) => {
            setStrategy(v as RoutingStrategy);
            setDirty(true);
          }}
          options={[
            { value: "first_available", title: m.settings_routing_first_available(), description: m.settings_routing_first_available_desc() },
            { value: "least_loaded", title: m.settings_routing_least_loaded(), description: m.settings_routing_least_loaded_desc() },
            { value: "closest", title: m.settings_routing_closest(), description: m.settings_routing_closest_desc() },
          ]}
        />
        {/* Banner, not a bare <p>: this is the sentence that stops someone
            trusting a radio that would do nothing, and `tone="warn"` also
            gives it role="alert" so a screen reader hears it when the
            selection changes. An earlier version used invented
            `ih-warn-*` classes, which Tailwind dropped silently and
            `lint:ds` did not catch — the text rendered unstyled. */}
        {blocker && <Banner tone="warn">{blocker}</Banner>}
      </div>

      {/* The anchor `closest` measures from. Shown for every strategy, because
          knowing the workspace is locatable is useful before choosing one. */}
      <div className="space-y-2 border-t border-ih-border pt-4">
        <p className="text-[12px] font-bold text-ih-fg-2">{m.settings_routing_company_anchor_label()}</p>
        {initial.companyAddress ? (
          <p className="text-[12px] text-ih-fg-3">
            {initial.companyAddress}
            {" — "}
            {hasCompanyAnchor
              ? m.settings_routing_anchor_located({
                  lat: initial.companyLat!.toFixed(4),
                  lng: initial.companyLng!.toFixed(4),
                })
              : m.settings_routing_anchor_missing()}
          </p>
        ) : (
          <p className="text-[12px] text-ih-fg-3">{m.settings_routing_anchor_no_address()}</p>
        )}
        <geocodeFetcher.Form method="post">
          <input type="hidden" name="intent" value="routing-geocode-company" />
          <button
            type="submit"
            disabled={geocoding || !initial.companyAddress || !initial.geocodeAvailable}
            className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors disabled:opacity-40"
          >
            {geocoding ? m.settings_routing_locating() : m.settings_routing_locate()}
          </button>
        </geocodeFetcher.Form>
        {geocodeResult && (
          <p className={`text-[12px] font-medium ${geocodeResult.ok ? "text-ih-ok-fg" : "text-ih-bad-fg"}`}>
            {geocodeResult.message ?? m.settings_holiday_save_failed()}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 border-t border-ih-border pt-4">
        <Input
          label={m.settings_routing_lead_label()}
          type="number"
          min={0}
          value={leadHours}
          hint={m.settings_routing_lead_hint()}
          onChange={(e) => {
            setLeadHours(e.target.value);
            setDirty(true);
          }}
        />
        <Input
          label={m.settings_routing_cutoff_label()}
          type="time"
          value={cutoff}
          hint={m.settings_routing_cutoff_hint()}
          onChange={(e) => {
            setCutoff(e.target.value);
            setDirty(true);
          }}
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="h-8 px-3 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
        >
          {saving ? m.settings_holiday_save_pending() : m.settings_routing_save()}
        </button>
        {saved && <span className="text-[13px] text-ih-ok-fg font-bold">{m.settings_holiday_saved()}</span>}
        {failed && (
          <span className="text-[13px] text-ih-bad-fg font-bold">
            {fetcher.data?.message ?? m.settings_holiday_save_failed()}
          </span>
        )}
      </div>
    </section>
  );
}
