import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Banner } from "@core/shared-ui";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import type { action } from "~/routes/settings-booking";
import { HolidayAdvancedDetails } from "./HolidayAdvancedDetails";
import {
  HolidayPresetCards,
  HolidayRegionPickerModal,
  type HolidayPresetId,
} from "./HolidayPresetCards";

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

function detectPreset(config: HolidayConfig): HolidayPresetId | null {
  if (!config.holidayRegion) return "off";
  if (
    config.holidayPublicPolicy === "block" &&
    config.holidayInternalPolicy === "advisory"
  ) {
    return "standard";
  }
  if (
    config.holidayPublicPolicy === "advisory" &&
    config.holidayInternalPolicy === "advisory" &&
    config.conciergeReviewRequired
  ) {
    return "on-call";
  }
  return null;
}

export function HolidayClosedPanel({
  initialConfig,
  initialCustomHolidays,
}: {
  initialConfig: HolidayConfig;
  initialCustomHolidays: CustomHoliday[];
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
  const [statePickerOpen, setStatePickerOpen] = useState(false);
  const [pendingPreset, setPendingPreset] = useState<"standard" | "on-call" | null>(null);
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

  const activePreset = detectPreset({
    holidayRegion: region,
    holidayPublicPolicy: publicPolicy,
    holidayInternalPolicy: internalPolicy,
    conciergeReviewRequired: concierge,
  });

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

  function applyStandard(regionValue: string) {
    setRegion(regionValue);
    setPublicPolicy("block");
    setInternalPolicy("advisory");
    setDirty(true);
    submitSave({
      holidayRegion: regionValue,
      holidayPublicPolicy: "block",
      holidayInternalPolicy: "advisory",
      conciergeReviewRequired: concierge,
    });
  }

  function applyOnCall(regionValue: string) {
    setRegion(regionValue);
    setPublicPolicy("advisory");
    setInternalPolicy("advisory");
    setConcierge(true);
    setDirty(true);
    submitSave({
      holidayRegion: regionValue,
      holidayPublicPolicy: "advisory",
      holidayInternalPolicy: "advisory",
      conciergeReviewRequired: true,
    });
  }

  function applyOff() {
    setRegion(null);
    setPublicPolicy("open");
    setInternalPolicy("advisory");
    setDirty(true);
    submitSave({
      holidayRegion: null,
      holidayPublicPolicy: "open",
      holidayInternalPolicy: "advisory",
      conciergeReviewRequired: concierge,
    });
  }

  function handlePreset(preset: HolidayPresetId) {
    if (preset === "off") {
      applyOff();
      return;
    }
    if (region) {
      if (preset === "standard") applyStandard(region);
      else applyOnCall(region);
      return;
    }
    setPendingPreset(preset);
    setStatePickerOpen(true);
  }

  function handleStatePick(code: string) {
    const regionValue = code === "US" ? "US" : `US-${code}`;
    setStatePickerOpen(false);
    if (pendingPreset === "on-call") applyOnCall(regionValue);
    else applyStandard(regionValue);
    setPendingPreset(null);
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
          Company holidays
        </h3>
        <p className="text-[12px] text-ih-fg-3 mt-1">
          Apply federal and state holidays to public booking and internal scheduling.
        </p>
      </div>

      <HolidayPresetCards
        activePreset={activePreset}
        saving={saving}
        onSelect={handlePreset}
      />

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
              Require office confirmation
            </span>
            <span className="block text-[12px] text-ih-fg-3 mt-0.5">
              Bookings on holiday dates stay pending until someone on your team confirms.
            </span>
          </span>
        </label>
      )}

      {publicPolicy === "advisory" && region && !concierge && (
        <Banner tone="warn">
          Bookings may confirm without review on holiday dates.
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

      <HolidayRegionPickerModal
        open={statePickerOpen}
        onPick={handleStatePick}
        onCancel={() => {
          setStatePickerOpen(false);
          setPendingPreset(null);
        }}
      />

      <ConfirmDialog
        open={openConfirmOpen}
        title="Allow bookings on holidays?"
        message="Customers can still book on listed holidays. Confirm only if that is intentional."
        confirmLabel="Allow bookings"
        onConfirm={confirmOpenSave}
        onCancel={() => setOpenConfirmOpen(false)}
      />
    </section>
  );
}
