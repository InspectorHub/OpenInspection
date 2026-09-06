import { useState } from "react";
import { Modal, Button, Input, Select, Checkbox } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export interface EditableDiscount {
  id: string;
  code: string;
  type: "percent" | "fixed";
  /** Stored units: whole percent, or CENTS for `fixed`. */
  value: number;
  active: boolean;
  maxUses?: number | null;
  expiresAt?: string | null;
}

/**
 * Edit one discount code.
 *
 * `PUT /api/services/discount-codes/{id}` has existed since it was written and
 * the panel called nothing, so every row's Edit was decorative and a code once
 * created could never be corrected or switched off.
 *
 * The value field is the part worth care: the server stores an integer that
 * means a whole percentage for `percent` and CENTS for `fixed`. So the label
 * and the step change with the type, and the dollars→cents conversion lives in
 * the resource route rather than here — one place, tested, instead of a
 * multiplication in a form handler.
 */
export function DiscountEditorModal({
  discount,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  discount: EditableDiscount | null;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (form: HTMLFormElement) => void;
}) {
  // Held in state because the value field's label, step and initial value all
  // depend on it, and the person may change it mid-edit.
  const [type, setType] = useState<"percent" | "fixed">(discount?.type ?? "percent");

  if (!discount) return null;

  const isPercent = type === "percent";
  // Shown in the units the label promises: percent as stored, fixed as dollars.
  const shownValue = discount.type === type
    ? (isPercent ? String(discount.value) : (discount.value / 100).toFixed(2))
    : "";

  return (
    <Modal open onClose={onClose} title={m.settings_discount_edit_title()} size="md">
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(e.currentTarget); }}
        className="space-y-4"
      >
        <input type="hidden" name="id" value={discount.id} />

        <Input
          name="code"
          defaultValue={discount.code}
          label={m.settings_discount_code_label()}
          autoFocus
          className="font-mono"
        />

        <Select
          name="type"
          value={type}
          onChange={(e) => setType(e.currentTarget.value as "percent" | "fixed")}
          label={m.settings_discount_type_label()}
        >
          <option value="percent">{m.settings_discount_type_percent()}</option>
          <option value="fixed">{m.settings_discount_type_fixed()}</option>
        </Select>

        <Input
          key={type}
          name="value"
          type="number"
          inputMode="decimal"
          min={0}
          step={isPercent ? 1 : 0.01}
          defaultValue={shownValue}
          label={isPercent ? m.settings_discount_value_percent_label() : m.settings_discount_value_fixed_label()}
          error={error}
          reserveErrorSpace
        />

        <Input
          name="maxUses"
          type="number"
          min={0}
          defaultValue={discount.maxUses == null ? "" : String(discount.maxUses)}
          label={m.settings_discount_maxuses_label()}
          hint={m.settings_discount_maxuses_hint()}
        />

        <Input
          name="expiresAt"
          type="date"
          defaultValue={discount.expiresAt ? discount.expiresAt.slice(0, 10) : ""}
          label={m.settings_discount_expires_label()}
          hint={m.settings_discount_expires_hint()}
        />

        {/* No hidden mirror. `FormData.get()` returns the FIRST entry, so a
            `value="false"` input placed beside this one would win WHILE the box
            was ticked and invert the switch. The route reads
            `active === "true"`, so an unticked box — which sends no entry at
            all — already means false. */}
        <Checkbox name="active" value="true" defaultChecked={discount.active} label={m.settings_discount_active_label()} />

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            {m.settings_discount_cancel()}
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? m.settings_discount_saving() : m.settings_discount_save()}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
