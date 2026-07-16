export const STEPS = ["Property", "Services", "Schedule", "Confirm"] as const;

export const TIME_WINDOWS = [
  { id: "morning", label: "Morning", detail: "8:00 AM - 12:00 PM" },
  { id: "afternoon", label: "Afternoon", detail: "12:00 PM - 5:00 PM" },
  // id must match the API timeSlot enum ('all-day', not 'allday')
  { id: "all-day", label: "All Day", detail: "Flexible timing" },
  { id: "custom", label: "Custom", detail: "Pick a specific time" },
] as const;

export interface CompanyProfile {
  company: string;
  turnstileSiteKey?: string | null;
  bookingOpen?: boolean;
  allowInspectorChoice?: boolean;
  conciergeReviewRequired?: boolean;
  inspectors: { id: string; name: string | null; photoUrl: string | null }[];
  services: { id: string; name: string; price: number; duration: number }[];
}
