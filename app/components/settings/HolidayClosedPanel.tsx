import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Banner } from "@core/shared-ui";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import type { action } from "~/routes/settings-booking";
import { HolidayAdvancedDetails } from "./HolidayAdvancedDetails";
import {
  HolidayPolicyCards,
  HolidayRegionSwitch,
  type HolidayPolicyId,
} from "./HolidayPolicyCards";
import { m } from "~/paraglide/messages";

export type HolidayPublicPolicy = "open" | "block" | "advisory";
export type HolidayInternalPolicy = "advisory" | "block";

export interface HolidayConfig {
  holidayRegion: string | null;
  holidayPublicPolicy: HolidayPublicPolicy;
  holidayInternalPolicy: HolidayInternalPolicy;
  conciergeReviewRequired: boolean;
}

export interface CustomHoliday {
  id: string;
  date: string;
  name: string;
}

/**
 * Which policy card reads as selected. `open` is deliberately unmatched: it is
 * an Advanced-only escape hatch (bookings taken on holidays anyway), and the
 * panel surfaces a notice rather than pretending it is one of the two cards.
 */
function detectPolicy(publicPolicy: HolidayPublicPolicy): HolidayPolicyId | null {
  if (publicPolicy === "block") return "closed";
  if (publicPolicy === "advisory") return "on-request";
  return null;
}

export function HolidayClosedPanel({
  initialConfig,
  initialCustomHolidays,
  dataMaxYear,
  currentYear,
}: {
  initialConfig: HolidayConfig;
  initialCustomHolidays: CustomHoliday[];
  /** Last year the bundled holiday catalog covers; used to warn before the cliff. */
  dataMaxYear?: number;
  /** Current civil year (from the loader) — compared against `dataMaxYear`. */
  currentYear?: number;
}) {
  const fetcher = useFetcher<typeof action>();
  const [region, setRegion] = useState<string | null>(initialConfig.holidayRegion);
  const [publicPolicy, setPublicPolicy] = useState<HolidayPublicPolicy>(
    initialConfig.holidayPublicPolicy,
  );
  const [internalPolicy, setInternalPolicy] = useState<HolidayInternalPolicy>(
    initialConfig.holidayInternalPolicy,
  );
  const [concierge, setConcierge] = useState(initialConfig.conciergeReviewRequired);
  const [customHolidays, setCustomHolidays] = useState(initialCustomHolidays);
  const [dirty, setDirty] = useState(false);
  const [openConfirmOpen, setOpenConfirmOpen] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");

  const saving = fetcher.state !== "idle";
  const saved =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "holidays-save" &&
    fetcher.data.ok === true &&
    !dirty;
  const failed =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "holidays-save" &&
    fetcher.data.ok === false &&
    !dirty;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.intent === "holiday-custom-add" && fetcher.data.ok && fetcher.data.holiday) {
      setCustomHolidays((prev) =>
        [...prev, fetcher.data!.holiday as CustomHoliday].sort((a, b) =>
          a.date.localeCompare(b.date),
        ),
      );
      setNewDate("");
      setNewName("");
    }
    if (fetcher.data.intent === "holiday-custom-delete" && fetcher.data.ok && fetcher.data.deletedId) {
      setCustomHolidays((prev) => prev.filter((h) => h.id !== fetcher.data!.deletedId));
    }
  }, [fetcher.state, fetcher.data]);

  const activePolicy = detectPolicy(publicPolicy);

  // Once the calendar has caught up to the last year we ship dates for, the
  // catalog is about to (or already does) run dry. Surface it while the region
  // is on — with no region there are no holidays to miss.
  const coverageExpiring =
    region != null &&
    dataMaxYear != null &&
    currentYear != null &&
    currentYear >= dataMaxYear;

  function submitSave(next: {
    holidayRegion: string | null;
    holidayPublicPolicy: HolidayPublicPolicy;
    holidayInternalPolicy: HolidayInternalPolicy;
    conciergeReviewRequired: boolean;
  }) {
    setDirty(false);
    fetcher.submit(
      {
        intent: "holidays-save",
        holidayRegion: next.holidayRegion ?? "",
        holidayPublicPolicy: next.holidayPublicPolicy,
        holidayInternalPolicy: next.holidayInternalPolicy,
        conciergeReviewRequired: String(next.conciergeReviewRequired),
      },
      { method: "post" },
    );
  }

  function applyPolicy(policy: HolidayPolicyId, regionValue: string) {
    const nextPublic: HolidayPublicPolicy = policy === "closed" ? "block" : "advisory";
    // Only "open on request" needs someone to confirm each request; turning it
    // on is what makes the policy mean anything. Switching back to "closed"
    // leaves concierge review alone — it is also used outside holidays.
    const nextConcierge = policy === "on-request" ? true : concierge;
    setPublicPolicy(nextPublic);
    setInternalPolicy("advisory");
    setConcierge(nextConcierge);
    setDirty(true);
    submitSave({
      holidayRegion: regionValue,
      holidayPublicPolicy: nextPublic,
      holidayInternalPolicy: "advisory",
      conciergeReviewRequired: nextConcierge,
    });
  }

  function handlePolicy(policy: HolidayPolicyId) {
    if (!region) return;
    applyPolicy(policy, region);
  }

  function handleRegion(next: string | null) {
    setRegion(next);
    setDirty(true);
    if (!next) {
      // Catalog off: no holidays exist, so the policies are inert. Park them at
      // the permissive values so a later re-enable does not silently resurrect
      // a policy the user never chose in this session.
      setPublicPolicy("open");
      setInternalPolicy("advisory");
      submitSave({
        holidayRegion: null,
        holidayPublicPolicy: "open",
        holidayInternalPolicy: "advisory",
        conciergeReviewRequired: concierge,
      });
      return;
    }
    // Turning the catalog on with no real policy yet: default to the safe one
    // rather than leaving both cards unselected.
    const policy = detectPolicy(publicPolicy) ?? "closed";
    applyPolicy(policy, next);
  }

  function handleAdvancedSave() {
    if (region && publicPolicy === "open") {
      setOpenConfirmOpen(true);
      return;
    }
    submitSave({
      holidayRegion: region,
      holidayPublicPolicy: publicPolicy,
      holidayInternalPolicy: internalPolicy,
      conciergeReviewRequired: concierge,
    });
  }

  function confirmOpenSave() {
    setOpenConfirmOpen(false);
    submitSave({
      holidayRegion: region,
      holidayPublicPolicy: "open",
      holidayInternalPolicy: internalPolicy,
      conciergeReviewRequired: concierge,
    });
  }

  return (
    <section
      data-testid="holiday-closed-panel"
      className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4"
    >
      <div>
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
          {m.settings_holiday_panel_heading()}
        </h3>
        <p className="text-[12px] text-ih-fg-3 mt-1">
          {m.settings_holiday_panel_desc()}
        </p>
      </div>

      {coverageExpiring && (
        <div data-testid="holiday-coverage-warn">
          <Banner tone="warn">
            {m.settings_holiday_coverage_warn({ year: dataMaxYear! })}
          </Banner>
        </div>
      )}

      <HolidayRegionSwitch region={region} saving={saving} onChange={handleRegion} />

      {region && (
        <HolidayPolicyCards
          activePolicy={activePolicy}
          saving={saving}
          onSelect={handlePolicy}
        />
      )}

      {region && publicPolicy === "open" && (
        <Banner tone="warn">{m.settings_holiday_policy_open_notice()}</Banner>
      )}

      {publicPolicy === "advisory" && region && (
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={concierge}
            onChange={(e) => {
              setConcierge(e.target.checked);
              setDirty(true);
            }}
            className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
          />
          <span>
            <span className="block text-[13px] font-bold text-ih-fg-1">
              {m.settings_holiday_concierge_label()}
            </span>
            <span className="block text-[12px] text-ih-fg-3 mt-0.5">
              {m.settings_holiday_concierge_desc()}
            </span>
          </span>
        </label>
      )}

      {publicPolicy === "advisory" && region && !concierge && (
        <Banner tone="warn">
          {m.settings_holiday_concierge_warn()}
        </Banner>
      )}

      <HolidayAdvancedDetails
        region={region}
        setRegion={setRegion}
        publicPolicy={publicPolicy}
        setPublicPolicy={setPublicPolicy}
        internalPolicy={internalPolicy}
        setInternalPolicy={setInternalPolicy}
        customHolidays={customHolidays}
        newDate={newDate}
        setNewDate={setNewDate}
        newName={newName}
        setNewName={setNewName}
        onRegionEnableDefaults={() => {
          if (!initialConfig.holidayRegion && publicPolicy === "open") {
            setPublicPolicy("block");
            setInternalPolicy("advisory");
          }
        }}
        onDirty={() => setDirty(true)}
        onAddCustom={() => {
          if (!newDate || !newName.trim()) return;
          fetcher.submit(
            { intent: "holiday-custom-add", date: newDate, name: newName.trim() },
            { method: "post" },
          );
        }}
        onRemoveCustom={(id) => {
          fetcher.submit(
            { intent: "holiday-custom-delete", id },
            { method: "post" },
          );
        }}
        onSave={handleAdvancedSave}
        saving={saving}
        saved={saved}
        failed={failed}
        failMessage={fetcher.data?.message}
      />

      <ConfirmDialog
        open={openConfirmOpen}
        title={m.settings_holiday_confirm_title()}
        message={m.settings_holiday_confirm_message()}
        confirmLabel={m.settings_holiday_public_open()}
        onConfirm={confirmOpenSave}
        onCancel={() => setOpenConfirmOpen(false)}
      />
    </section>
  );
}
