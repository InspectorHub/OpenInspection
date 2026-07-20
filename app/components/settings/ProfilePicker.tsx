// Appearance-profile gallery (tenant default / template default / inspection
// override). DS-token markup mirrors the retired report-theme radio
// (peer-checked:border-ih-primary, bg-ih-primary-tint). Each card renders its own
// name in that profile's real typography (scoped presetTokens) so the control
// previews the look instead of only labeling it.
import { CLIENT_PROFILE_LIST } from "~/lib/report-style/profiles-client";
import { presetTokens } from "~/lib/report-style/preset-tokens";

export function ProfilePicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange?: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {CLIENT_PROFILE_LIST.map((p) => (
        <label key={p.id} className="cursor-pointer">
          <input
            type="radio"
            name={name}
            value={p.id}
            checked={value === p.id}
            onChange={() => onChange?.(p.id)}
            className="sr-only peer"
          />
          <div className="p-4 rounded-md border-2 text-center transition-all border-ih-border bg-ih-bg-card text-ih-fg-2 peer-checked:border-ih-primary peer-checked:bg-ih-primary-tint peer-checked:text-ih-primary">
            <div
              className="text-[15px] tracking-[0.06em]"
              style={{
                ...presetTokens(p.tokens),
                fontFamily: "var(--report-heading-font)",
                fontWeight: "var(--report-heading-weight)" as unknown as number,
                letterSpacing: "var(--report-heading-spacing)",
                textTransform: "var(--report-heading-transform)" as unknown as "none",
              }}
            >
              {p.name}
            </div>
            <div className="text-[11px] text-ih-fg-3 mt-1.5 normal-case tracking-normal">{p.hint}</div>
          </div>
        </label>
      ))}
    </div>
  );
}
