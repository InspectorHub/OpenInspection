import { RadioGroup } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * "Which inspections can this person see": everything in the company, or only what is assigned to them
 * as lead or helper. Shown for inspectors only (the caller decides); every other role pins the answer.
 * Written once for both drawers so they cannot word or order it differently.
 */
export function ScopeControl({ name, viewAll, onChange }: { name: string; viewAll: boolean; onChange: (viewAll: boolean) => void }) {
  return (
    <RadioGroup
      name={name}
      value={viewAll ? "all" : "assigned"}
      onChange={(v) => onChange(v === "all")}
      legend={m.team_scope_heading()}
      legendClassName="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1"
      options={[
        { value: "all", label: m.team_scope_all() },
        { value: "assigned", label: m.team_scope_assigned() },
      ]}
      // Only when it applies: a person who sees everything has nothing left to explain.
      {...(viewAll ? {} : { hint: m.team_scope_hint() })}
    />
  );
}
