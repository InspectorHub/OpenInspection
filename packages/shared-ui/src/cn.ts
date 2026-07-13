import { twMerge } from "tailwind-merge";

/** Compose class strings, letting later (consumer) classes win Tailwind conflicts. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return twMerge(parts.filter(Boolean).join(" "));
}
