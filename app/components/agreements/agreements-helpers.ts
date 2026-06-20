export interface RequestRow {
  id: string;
  agreementName?: string;
  clientName?: string;
  clientEmail?: string;
  status: string;
  signersTotal?: number;
  signersSigned?: number;
}

export interface InspectionOption {
  id: string;
  propertyAddress: string | null;
  clientName: string | null;
}

export type StatusTone = "sat" | "gen" | "neutral";
export function pillToneFor(status: string): StatusTone {
  if (status === "signed") return "sat";
  if (status === "declined" || status === "expired") return "neutral";
  return "gen";
}
export function pillLabelFor(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
