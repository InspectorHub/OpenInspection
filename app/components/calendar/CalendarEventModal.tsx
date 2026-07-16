import { useNavigate } from "react-router";
import { Modal } from "@core/shared-ui";
import type { CalendarEvent } from "~/components/calendar/calendar-helpers";

interface CalendarEventModalProps {
  event: CalendarEvent;
  open: boolean;
  displayTz: string;
  onClose: () => void;
}

export function CalendarEventModal({ event, open, displayTz, onClose }: CalendarEventModalProps) {
  const navigate = useNavigate();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={event.title}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3"
          >
            Close
          </button>
          {event.id && (
            <button
              type="button"
              onClick={() => {
                const inspectionId = event.extendedProps?.inspectionId;
                navigate(`/inspections/${typeof inspectionId === "string" ? inspectionId : event.id}`);
                onClose();
              }}
              className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600"
            >
              Open Inspection
            </button>
          )}
        </>
      }
    >
      <div className="space-y-2 text-[13px] text-ih-fg-3">
        <p>
          <span className="font-bold text-ih-fg-3 text-[11px] uppercase">Date:</span>{" "}
          {event.start
            ? new Date(event.start).toLocaleString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZone: displayTz,
                timeZoneName: "short",
              })
            : "N/A"}
        </p>
        {event.status && (
          <p>
            <span className="font-bold text-ih-fg-3 text-[11px] uppercase">Status:</span>{" "}
            {event.status.replace(/_/g, " ")}
          </p>
        )}
      </div>
    </Modal>
  );
}
