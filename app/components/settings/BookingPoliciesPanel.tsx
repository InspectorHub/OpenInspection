import { useState } from "react";
import { useFetcher } from "react-router";
import type { action } from "~/routes/settings-booking";

interface TenantConfig {
  conciergeReviewRequired: boolean;
  blockUnsignedAgreement: boolean;
  allowInspectorChoice: boolean;
}

export function BookingPoliciesPanel({ initialConfig }: { initialConfig: TenantConfig }) {
  const fetcher = useFetcher<typeof action>();
  const [concierge, setConcierge] = useState(initialConfig.conciergeReviewRequired);
  const [blockUnsigned, setBlockUnsigned] = useState(initialConfig.blockUnsignedAgreement);
  const [allowChoice, setAllowChoice] = useState(initialConfig.allowInspectorChoice);
  const [dirty, setDirty] = useState(false);

  const saving = fetcher.state !== "idle";
  const saved =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "policies-save" &&
    fetcher.data.ok === true &&
    !dirty;

  const failed =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "policies-save" &&
    fetcher.data.ok === false &&
    !dirty;

  function handleSave() {
    setDirty(false);
    fetcher.submit(
      {
        intent: "policies-save",
        conciergeReviewRequired: String(concierge),
        blockUnsignedAgreement: String(blockUnsigned),
        allowInspectorChoice: String(allowChoice),
      },
      { method: "post" },
    );
  }

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Booking policies</h3>

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={concierge}
          onChange={(e) => { setConcierge(e.target.checked); setDirty(true); }}
          className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
        />
        <span>
          <span className="block text-[13px] font-bold text-ih-fg-1">Require concierge review</span>
          <span className="block text-[12px] text-ih-fg-3 mt-0.5">
            Agent-submitted bookings must be approved by you before the client receives a confirmation link.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={blockUnsigned}
          onChange={(e) => { setBlockUnsigned(e.target.checked); setDirty(true); }}
          className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
        />
        <span>
          <span className="block text-[13px] font-bold text-ih-fg-1">Require signed agreement</span>
          <span className="block text-[12px] text-ih-fg-3 mt-0.5">
            Clients must sign the inspection agreement before the booking is confirmed.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allowChoice}
          onChange={(e) => { setAllowChoice(e.target.checked); setDirty(true); }}
          className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
        />
        <span>
          <span className="block text-[13px] font-bold text-ih-fg-1">Allow clients to choose their inspector</span>
          <span className="block text-[12px] text-ih-fg-3 mt-0.5">
            When off, bookings are auto-assigned to the first available inspector.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save policies"}
        </button>
        {saved && <span className="text-[13px] text-ih-ok-fg font-bold">Saved.</span>}
        {failed && (
          <span className="text-[13px] text-ih-bad-fg font-bold">
            {fetcher.data?.message ?? "Save failed. Please try again."}
          </span>
        )}
      </div>
    </section>
  );
}
