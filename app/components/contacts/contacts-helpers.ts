/**
 * Best-effort column mapping for the simple "paste CSV → import" flow:
 * matches column headers case-insensitively against the canonical field
 * names. If the CSV uses non-standard headers, falls back to the first
 * column as `name` so the import still succeeds for the common case.
 */
export function inferMappingFromCsv(csv: string): { name: string; email?: string; phone?: string; agency?: string } {
  const firstLine = csv.split(/\r?\n/, 1)[0] ?? "";
  const cols = firstLine.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const find = (...needles: string[]) =>
    cols.find((c) => needles.some((n) => c.toLowerCase() === n));
  const nameCol = find("name", "full name", "contact") ?? cols[0] ?? "name";
  const emailCol = find("email", "e-mail");
  const phoneCol = find("phone", "tel", "mobile");
  const agencyCol = find("agency", "company", "organization");
  const m: { name: string; email?: string; phone?: string; agency?: string } = { name: nameCol };
  if (emailCol) m.email = emailCol;
  if (phoneCol) m.phone = phoneCol;
  if (agencyCol) m.agency = agencyCol;
  return m;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  type: string;
  agency: string;
  inspectionCount?: number;
}

export interface Agent {
  id: string;
  name: string;
  email: string;
  status: string;
  linkedAt: string;
}
