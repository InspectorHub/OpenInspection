// Renders 0-N inspector credentials (Spec B). Image credentials -> <img> (equal
// height); text-only credentials -> "label #member". layout comes from the
// resolved profile's badgeLayout (Plan 1a): 'strip' = its own wrapping row,
// 'inline' = sits beside adjacent content. §4-safe: introduces no brand hue.
export interface CredentialItem {
  label: string;
  memberNumber: string | null;
  imageUrl: string | null;
}

export function CredentialBadges({
  credentials,
  layout,
}: {
  credentials: CredentialItem[];
  layout: "strip" | "inline";
}) {
  // Drop empty rows (no image AND blank label) — e.g. a credential added but
  // never filled — so a stray "Add" never renders a lone " · " on the report.
  const shown = credentials.filter((c) => c.imageUrl || c.label.trim());
  if (!shown.length) return null;
  const images = shown.filter((c) => c.imageUrl);
  const texts = shown.filter((c) => !c.imageUrl);
  return (
    <div className={layout === "strip" ? "flex flex-wrap items-center gap-2 mt-2" : "flex items-center gap-2"}>
      {images.map((c, i) => (
        <img key={i} src={c.imageUrl!} alt={c.label || "Inspector credential"} className="h-10 w-auto" />
      ))}
      {texts.length > 0 && (
        <span className="text-[11px] text-ih-fg-3">
          {texts.map((c) => (c.memberNumber ? `${c.label} #${c.memberNumber}` : c.label)).join(" · ")}
        </span>
      )}
    </div>
  );
}
