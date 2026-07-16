import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Drawer, Modal } from "@core/shared-ui";
import type { CalendarEvent } from "./calendar-helpers";

export interface CalendarMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface BlockActionData {
  ok: boolean;
  intent?: string;
  message?: string | null;
}

interface BlockTimeDrawerProps {
  open: boolean;
  block: CalendarEvent | null;
  dateSeed: string | null;
  currentUserId: string;
  members: CalendarMember[];
  canManageTeam: boolean;
  onClose: () => void;
}

function eventValue(event: CalendarEvent | null, key: string): string | undefined {
  const value = event?.extendedProps?.[key];
  return typeof value === "string" ? value : undefined;
}

export function BlockTimeDrawer({
  open,
  block,
  dateSeed,
  currentUserId,
  members,
  canManageTeam,
  onClose,
}: BlockTimeDrawerProps) {
  const fetcher = useFetcher<BlockActionData>();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [allDay, setAllDay] = useState(false);
  const [notes, setNotes] = useState("");
  const [userId, setUserId] = useState(currentUserId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    const seed = block?.start ?? dateSeed ?? new Date().toISOString();
    const isAllDay = block?.extendedProps?.allDay === true;
    setTitle(block?.title ?? "");
    setDate(seed.slice(0, 10));
    setStartTime(isAllDay ? "09:00" : seed.slice(11, 16) || "09:00");
    setEndTime(isAllDay ? "10:00" : block?.end?.slice(11, 16) || "10:00");
    setAllDay(isAllDay);
    setNotes(eventValue(block, "notes") ?? "");
    setUserId(eventValue(block, "userId") ?? currentUserId);
    setConfirmDelete(false);
  }, [block, currentUserId, dateSeed, open]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onClose();
  }, [fetcher.data, fetcher.state, onClose]);

  const submitting = fetcher.state !== "idle";
  const error = fetcher.data?.ok === false ? fetcher.data.message : null;

  function submitBlock(event: React.FormEvent) {
    event.preventDefault();
    fetcher.submit(
      {
        intent: block ? "block-update" : "block-create",
        ...(block ? { id: block.id } : {}),
        title,
        date,
        allDay: String(allDay),
        startTime: allDay ? "" : startTime,
        endTime: allDay ? "" : endTime,
        notes,
        userId,
      },
      { method: "post" },
    );
  }

  function deleteBlock() {
    if (!block) return;
    fetcher.submit(
      { intent: "block-delete", id: block.id },
      { method: "post" },
    );
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={block ? "Edit blocked time" : "Block time"}
        initialFocusRef={titleRef}
        footer={
          <>
            {block && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={submitting}
                className="mr-auto h-9 px-3 rounded-md border border-ih-bad text-[13px] font-bold text-ih-bad-fg hover:bg-ih-bad-tint disabled:opacity-50"
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="block-time-form"
              disabled={submitting}
              className="h-9 px-4 rounded-md bg-ih-primary text-[13px] font-bold text-white hover:bg-ih-primary-600 disabled:opacity-50"
            >
              {submitting ? "Saving..." : block ? "Save changes" : "Block time"}
            </button>
          </>
        }
      >
        <form id="block-time-form" onSubmit={submitBlock} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">Title</span>
            <input
              ref={titleRef}
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Personal appointment"
              className="w-full rounded-md border border-ih-border bg-ih-bg-card px-3 py-2 text-[13px] text-ih-fg-1"
            />
          </label>

          {canManageTeam && members.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">Inspector</span>
              <select
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                className="w-full rounded-md border border-ih-border bg-ih-bg-card px-3 py-2 text-[13px] text-ih-fg-1"
              >
                {members.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">Date</span>
            <input
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="w-full rounded-md border border-ih-border bg-ih-bg-card px-3 py-2 text-[13px] text-ih-fg-1"
            />
          </label>

          <label className="flex items-center gap-2 text-[13px] font-medium text-ih-fg-2">
            <input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />
            All day
          </label>

          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">Starts</span>
                <input
                  type="time"
                  required
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  className="w-full rounded-md border border-ih-border bg-ih-bg-card px-3 py-2 text-[13px] text-ih-fg-1"
                />
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">Ends</span>
                <input
                  type="time"
                  required
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  className="w-full rounded-md border border-ih-border bg-ih-bg-card px-3 py-2 text-[13px] text-ih-fg-1"
                />
              </label>
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">Notes</span>
            <textarea
              rows={4}
              maxLength={2000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="w-full rounded-md border border-ih-border bg-ih-bg-card px-3 py-2 text-[13px] text-ih-fg-1"
            />
          </label>
          {error && <p className="text-[12px] font-medium text-ih-bad-fg">{error}</p>}
        </form>
      </Drawer>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete blocked time?"
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="h-9 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3"
            >
              Keep block
            </button>
            <button
              type="button"
              onClick={deleteBlock}
              disabled={submitting}
              className="h-9 px-3 rounded-md bg-ih-bad text-[13px] font-bold text-white disabled:opacity-50"
            >
              Delete
            </button>
          </>
        }
      >
        <p className="text-[13px] text-ih-fg-3">This blocked time will be removed from the calendar.</p>
      </Modal>
    </>
  );
}
