import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { m } from "~/paraglide/messages";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { DiscountEditorModal, type EditableDiscount } from "./DiscountEditorModal";

interface Discount {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  active: boolean;
  maxUses?: number | null;
  expiresAt?: string | null;
}

export function DiscountCodesPanel({ discounts }: { discounts: Discount[] }) {
  const [editing, setEditing] = useState<EditableDiscount | null>(null);
  const { submit, fetcher, busy } = useGuardedSubmit<{ ok?: boolean; error?: string }>();
  const revalidator = useRevalidator();

  // In an effect, never during render: the page owns the row data, so a
  // successful save has to close the dialog AND re-read the list.
  const reply = fetcher.state === "idle" ? fetcher.data : undefined;
  const handled = useRef<typeof reply>(undefined);
  useEffect(() => {
    if (!reply || handled.current === reply) return;
    handled.current = reply;
    if (reply.ok) {
      setEditing(null);
      revalidator.revalidate();
    }
  }, [reply, revalidator]);

  function save(form: HTMLFormElement) {
    const fd = new FormData(form);
    const payload: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (typeof v === "string") payload[k] = v;
    submit(payload, { method: "post", action: "/resources/discount-codes" });
  }

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
                <button
                  type="button"
                  onClick={() => setEditing(d)}
                  disabled={busy}
                  className="text-[12px] font-semibold text-ih-primary-text hover:underline disabled:opacity-50"
                >
                  {m.settings_discount_edit_action()}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Keyed on the row. The editor derives its `type` from the discount in
          a `useState` initialiser, and an initialiser runs ONCE — mounted with
          `discount: null` it would stay on "percent" forever, so a $50 fixed
          code opened as "Percent off" with an empty amount and saving it would
          have converted the code. Remounting per row is what makes the
          initialiser see the real value. */}
      <DiscountEditorModal
        key={editing?.id ?? "none"}
        discount={editing}
        busy={busy}
        error={reply?.ok === false ? reply.error : undefined}
        onClose={() => setEditing(null)}
        onSubmit={save}
      />
    </div>
  );
}
