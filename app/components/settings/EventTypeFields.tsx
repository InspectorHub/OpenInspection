import type { Dispatch, RefObject, SetStateAction } from "react";
import { MoneyInput } from "@core/field-ui/components/MoneyInput";
import { m } from "~/paraglide/messages";

export interface EventTypeFormState {
  name: string;
  slug: string;
  defaultDurationMin: number;
  priceDollars: number;
  color: string;
  sortOrder: number;
  followUpDelayHours: string;
}

/** The fields of the create / edit dialog for an event type. */
export function EventTypeFields({ form, setForm, nameRef }: {
  form: EventTypeFormState;
  setForm: Dispatch<SetStateAction<EventTypeFormState>>;
  nameRef: RefObject<HTMLInputElement | null>;
}) {
  return (
        <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                  {m.settings_event_types_name_label()}
                </label>
                <input
                  ref={nameRef}
                  type="text"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder={m.settings_event_types_name_placeholder()}
                  className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                  {m.settings_event_types_slug_label()}
                </label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, slug: e.target.value }))
                  }
                  placeholder={m.settings_event_types_slug_placeholder()}
                  className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 font-mono focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                    {m.settings_event_types_duration_label()}
                  </label>
                  <input
                    type="number"
                    value={form.defaultDurationMin}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        defaultDurationMin: Number(e.target.value),
                      }))
                    }
                    min={1}
                    className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                    {m.settings_event_types_price_label()}
                  </label>
                  <MoneyInput
                    cents={Math.round(form.priceDollars * 100)}
                    onChange={(c) =>
                      setForm((f) => ({
                        ...f,
                        priceDollars: c == null ? 0 : c / 100,
                      }))
                    }
                    ariaLabel={m.settings_event_types_price_label()}
                    className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                    {m.settings_event_types_color_label()}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.color}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, color: e.target.value }))
                      }
                      className="w-10 h-10 rounded-md border border-ih-border cursor-pointer"
                    />
                    <input
                      type="text"
                      value={form.color}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, color: e.target.value }))
                      }
                      className="flex-1 px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 font-mono focus:border-ih-primary focus:shadow-ih-focus outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                    {m.settings_event_types_sort_label()}
                  </label>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        sortOrder: Number(e.target.value),
                      }))
                    }
                    min={0}
                    className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                  {m.settings_event_types_followup_label()}
                </label>
                <input
                  type="number"
                  value={form.followUpDelayHours}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, followUpDelayHours: e.target.value }))
                  }
                  min={0}
                  max={8760}
                  placeholder="72"
                  data-testid="event-type-followup-input"
                  className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
                {/* This one earns always-on help: the field's whole subtlety is
                    that 0 is a setting rather than a blank, which a label and a
                    placeholder cannot say. */}
                <p className="mt-1 text-[11px] text-ih-fg-3">
                  {m.settings_event_types_followup_hint()}
                </p>
              </div>
        </div>
  );
}
