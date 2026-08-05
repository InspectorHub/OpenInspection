import { useState } from "react";
import { Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { FindATimeModal } from "../dispatch/FindATimeModal";
import type { WizardTeamMember } from "../NewInspectionWizard";

/**
 * The Schedule step's second question.
 *
 * The date picker asks "when do you want it"; this asks "when could it actually
 * happen". It lives beside the step rather than inside it because a chosen slot
 * sets THREE of that step's fields at once — date, time, and (only when the
 * answer is unambiguous) the inspector — and a control that writes three fields
 * belongs where all three are owned.
 *
 * Its own file because the wizard is at its size cap; the open/closed state has
 * no other reader, so it travels with the button rather than the wizard.
 */
export function FindATimeLauncher({
  date,
  teamMembers,
  onPick,
}: {
  date: string;
  teamMembers: WizardTeamMember[];
  onPick: (pick: { date: string; time: string; inspectorId: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOpen(true)}
          data-testid="find-a-time-open"
        >
          {m.find_a_time_open()}
        </Button>
      </div>
      <FindATimeModal
        open={open}
        onClose={() => setOpen(false)}
        initialDate={date}
        members={teamMembers}
        onPick={onPick}
      />
    </>
  );
}
