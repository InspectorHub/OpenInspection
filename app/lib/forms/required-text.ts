import { z } from "zod";

/**
 * A required text field, with the message the user should actually read.
 *
 * `z.string().min(1, "Enter a name")` looks like it covers an empty field. It does
 * not. Conform strips blank values before validating, so the field arrives as
 * `undefined`, `min` never runs, and what reaches the user is zod's own
 * "Invalid input" — measured live on Settings → Services, where submitting the
 * create form with no name showed exactly that under the field.
 *
 * The `error` option is the one that covers an absent value, so every required
 * text field in a Conform-driven form has to declare it. Callers keep their `min`
 * for the non-empty cases (too short, not just missing).
 */
export function requiredText(message: string) {
    return z.string({ error: message });
}
