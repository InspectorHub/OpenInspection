import { formatPriceCents } from "~/lib/wizard-steps";
import { getEffectivePriceCents } from "~/lib/effective-price";
import { MoneyInput } from "~/components/MoneyInput";
import type { WizardService } from "../NewInspectionWizard";

export function ServicesStep({
  serviceCatalog,
  services,
  priceOverrides,
  toggleService,
  handlePriceOverrideChange,
}: {
  serviceCatalog: WizardService[];
  services: Set<string>;
  priceOverrides: Map<string, number>;
  toggleService: (id: string) => void;
  handlePriceOverrideChange: (serviceId: string, cents: number | null, catalogCents: number | null | undefined) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Select Services</label>
      <div className="space-y-1.5">
        {serviceCatalog.map((s) => {
          const selected = services.has(s.id);
          const catalogCents = typeof s.price === "number" && s.price > 0 ? s.price : null;
          const overrideCents = priceOverrides.get(s.id);
          // Price shown in the input: the override, else the catalog price, else empty.
          const priceCents = overrideCents !== undefined ? overrideCents : catalogCents;
          return (
            <div
              key={s.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border transition-colors ${selected ? "border-ih-primary bg-ih-primary-tint" : "border-ih-border"}`}
            >
              {/* Checkbox + service name — clicking the left area toggles selection */}
              <button
                type="button"
                onClick={() => toggleService(s.id)}
                className={`flex-1 text-left text-[12px] font-medium flex items-center gap-1.5 ${selected ? "text-ih-primary" : "text-ih-fg-3"}`}
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${selected ? "border-ih-primary bg-ih-primary text-white" : "border-ih-border"}`}>
                  {selected ? "✓" : ""}
                </span>
                {s.name}
              </button>
              {/* Price: editable input when selected, static text otherwise */}
              {selected ? (
                <MoneyInput
                  cents={priceCents}
                  onChange={(c) => handlePriceOverrideChange(s.id, c, catalogCents)}
                  className="w-24 h-7 px-1.5 rounded border border-ih-border bg-ih-bg-card text-[12px] text-right focus:shadow-ih-focus outline-none"
                  ariaLabel={`Price for ${s.name}`}
                />
              ) : catalogCents !== null ? (
                // FE-7: price is stored in cents — "$400.00", not "$40000"
                <span className="text-[12px] text-ih-fg-4 flex-shrink-0">{formatPriceCents(catalogCents)}</span>
              ) : null}
            </div>
          );
        })}
      </div>
      {/* P-4: Live total across selected services — delegates to the authority-chain
          helper. At wizard time there is no invoice yet, so only tier 2 applies.
          Catalog svc.price maps to priceSnapshot; per-row priceOverrides maps to
          priceOverride. Empty set falls through to zero (no cache row here). */}
      {services.size > 0 && (
        <div className="flex justify-end pt-1 border-t border-ih-border mt-2">
          <span className="text-[12px] font-bold text-ih-fg-2">
            Total:{" "}
            {formatPriceCents(
              getEffectivePriceCents({
                serviceLines: [...services].map((id) => {
                  const svc = serviceCatalog.find((s) => s.id === id);
                  return {
                    priceSnapshot: typeof svc?.price === "number" ? svc.price : 0,
                    priceOverride: priceOverrides.get(id) ?? null,
                  };
                }),
              }),
            )}
          </span>
        </div>
      )}
    </div>
  );
}
