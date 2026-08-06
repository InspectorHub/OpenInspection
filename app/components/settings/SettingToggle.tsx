/**
 * A settings checkbox with a bold title and an explanatory line beneath it.
 *
 * Conform-native: a checked box submits the single value `"on"` and an
 * unchecked one submits nothing, which is what lets `submission.value` coerce
 * to a boolean. Do NOT add a hidden "false" sibling — two values for one name
 * breaks `z.boolean()` parsing (see `makeWorkspaceSchema`). The action is
 * responsible for turning the resulting `undefined` back into an explicit
 * `false` so that unchecking persists.
 */
export function SettingToggle({
  name,
  defaultChecked,
  title,
  description,
}: {
  name: string;
  defaultChecked: boolean;
  title: string;
  description: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <input
        type="checkbox"
        name={name}
        value="on"
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
      />
      <span>
        <span className="block text-[13px] font-bold text-ih-fg-1">{title}</span>
        <span className="block text-[12px] text-ih-fg-3 mt-0.5">{description}</span>
      </span>
    </label>
  );
}
