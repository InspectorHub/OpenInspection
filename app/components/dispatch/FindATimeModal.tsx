import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { Button, Modal, Select } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { DaySlotsPayload } from "~/routes/resources/day-slots";
import { startsFittingDuration } from "./dispatch-helpers";

export interface FindATimeMember {
  id: string;
  name: string;
  email?: string;
}

const DURATION_CHOICES = [60, 90, 120, 180, 240];

/**
 * "When could this actually happen?" — the question the wizard's date picker
 * cannot answer.
 *
 * Slots arrive through a route loader, never a browser `fetch('/api/…')`: the
 * JWT lives in an HttpOnly cookie the React Router server relays, so a direct
 * client call would be unauthenticated. And it is the STAFF slots endpoint, not
 * the public booking one — the public surface deliberately withholds which
 * inspector is free, which is the only part a dispatcher needs.
 *
 * A start is offered only when the whole DURATION fits from it. Showing a free
 * 09:00 for a three-hour job whose 10:00 is taken would be a promise the
 * calendar cannot keep.
 */
export function FindATimeModal({
  open,
  onClose,
  initialDate,
  members,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  initialDate: string;
  members: FindATimeMember[];
  onPick: (pick: { date: string; time: string; inspectorId: string | null }) => void;
}) {
  const fetcher = useFetcher<DaySlotsPayload>();
  const [date, setDate] = useState(initialDate);
  const [durationMin, setDurationMin] = useState(DURATION_CHOICES[0]);
  const [inspectorId, setInspectorId] = useState("");

  useEffect(() => { if (open) setDate(initialDate); }, [open, initialDate]);

  useEffect(() => {
    if (!open || !date) return;
    const params = new URLSearchParams({ date });
    if (inspectorId) params.set("userIds", inspectorId);
    fetcher.load(`/resources/day-slots?${params.toString()}`);
    // The fetcher identity changes every render; depending on it would reload
    // in a loop. The inputs below are the whole query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, date, inspectorId]);

  const data = fetcher.data;
  const slots = useMemo(() => data?.slots ?? [], [data]);
  const fitting = useMemo(
    () => startsFittingDuration(slots, data?.intervalMin ?? 30, durationMin),
    [slots, data?.intervalMin, durationMin],
  );

  const loading = fetcher.state !== "idle";
  const memberName = (id: string) =>
    members.find((member) => member.id === id)?.name ?? id;

  return (
    <Modal open={open} onClose={onClose} title={m.find_a_time_title()} size="lg"
      footer={<Button variant="secondary" onClick={onClose}>{m.find_a_time_close()}</Button>}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] font-bold text-ih-fg-2">
          {m.find_a_time_date()}
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-9 rounded-lg border border-ih-border bg-ih-bg-card px-2 text-[13px] font-normal text-ih-fg-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-[12px] font-bold text-ih-fg-2">
          {m.find_a_time_duration()}
          <Select
            value={String(durationMin)}
            onChange={(event) => setDurationMin(Number(event.target.value))}
            options={DURATION_CHOICES.map((minutes) => ({
              value: String(minutes),
              label: m.find_a_time_minutes({ count: minutes }),
            }))}
          />
        </label>

        <label className="flex flex-col gap-1 text-[12px] font-bold text-ih-fg-2">
          {m.find_a_time_inspector()}
          <Select
            value={inspectorId}
            onChange={(event) => setInspectorId(event.target.value)}
            options={[
              { value: "", label: m.find_a_time_anyone() },
              ...members.map((member) => ({ value: member.id, label: member.name })),
            ]}
          />
        </label>
      </div>

      <div className="mt-4" data-testid="find-a-time-results">
        {data?.holidayAdvisory && (
          <p className="mb-2 rounded-lg bg-ih-bg-muted px-3 py-2 text-[12px] text-ih-fg-2">
            {m.dispatch_closed_prefix()}: {data.holidayAdvisory.name}
          </p>
        )}

        {loading && <p className="text-[12px] text-ih-fg-3">{m.find_a_time_loading()}</p>}

        {/* "Nothing is free" and "we could not find out" are different answers,
            and only one of them means keep looking on this day. */}
        {!loading && data?.failed && (
          <p className="text-[12px] text-ih-bad-fg">{m.find_a_time_failed()}</p>
        )}

        {!loading && data && !data.failed && fitting.size === 0 && (
          <p className="text-[12px] text-ih-fg-3">{m.find_a_time_none()}</p>
        )}

        {!loading && fitting.size > 0 && (
          <div className="flex flex-wrap gap-2">
            {slots.filter((slot) => fitting.has(slot.time)).map((slot) => (
              <button
                key={slot.time}
                type="button"
                data-testid="find-a-time-slot"
                onClick={() => {
                  onPick({
                    date,
                    time: slot.time,
                    // Only commit an inspector when the answer is unambiguous:
                    // an explicit filter, or exactly one person free then.
                    inspectorId: inspectorId || (slot.inspectorIds.length === 1 ? slot.inspectorIds[0] : null),
                  });
                  onClose();
                }}
                className="rounded-lg border border-ih-border bg-ih-bg-card px-3 py-2 text-left hover:bg-ih-bg-muted"
              >
                <span className="block text-[13px] font-bold text-ih-fg-1">{slot.time}</span>
                <span className="block text-[11px] text-ih-fg-3">
                  {slot.inspectorIds.length === 1
                    ? memberName(slot.inspectorIds[0])
                    : m.find_a_time_free_count({ count: slot.inspectorIds.length })}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
