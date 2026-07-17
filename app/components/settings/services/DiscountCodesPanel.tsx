import { m } from "~/paraglide/messages";

interface Discount {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  active: boolean;
}

export function DiscountCodesPanel({ discounts }: { discounts: Discount[] }) {
  return (
    <div className="pt-2">
      <h3 className="text-[15px] font-bold text-ih-fg-1 mb-2">{m.settings_discount_heading()}</h3>
      <p className="text-[13px] text-ih-fg-3 mb-3">{m.settings_discount_desc()}</p>

      <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
        {discounts.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-ih-fg-3">
            {m.settings_discount_none()}
          </div>
        ) : (
          <div className="divide-y divide-ih-border">
            {discounts.map((d) => (
              <div key={d.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-4">
                  <code className="font-mono text-[13px] font-bold text-ih-fg-1">{d.code}</code>
                  <span className="text-[12px] text-ih-fg-3">
                    {d.type === "percent" ? m.settings_discount_percent_off({ value: d.value }) : m.settings_discount_fixed_off({ amount: (d.value / 100).toFixed(2) })}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
 d.active
 ? "bg-ih-ok-bg text-ih-ok-fg"
 : "bg-ih-bg-muted text-ih-fg-3"
 }`}>
                    {d.active ? m.settings_discount_active() : m.settings_discount_disabled()}
                  </span>
                </div>
                <button className="text-[12px] font-semibold text-ih-primary hover:underline">
                  {m.common_edit()}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
