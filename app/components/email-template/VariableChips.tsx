export function VariableChips({ variables, onInsert }: { variables: { name: string; desc: string }[]; onInsert: (token: string) => void }) {
  if (!variables.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {variables.map((v) => (
        <button key={v.name} type="button" title={v.desc} onClick={() => onInsert(`{{${v.name}}}`)}
          className="group inline-flex items-center gap-1 h-6 px-2 rounded-md border border-ih-border bg-ih-bg-muted text-[11px] font-mono text-ih-fg-2 hover:border-ih-primary hover:text-ih-primary hover:bg-ih-primary-tint transition-colors">
          <span className="text-ih-fg-4 group-hover:text-ih-primary">{"{ }"}</span>{v.name}
        </button>
      ))}
    </div>
  );
}
