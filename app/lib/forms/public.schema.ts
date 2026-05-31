import { z } from "zod";

/**
 * Form schemas for PUBLIC (unauthenticated) forms, mirroring the API's
 * validation rules. Kept as plain zod so the SAME schema runs in the route
 * action (`parseWithZod`) and in the browser via Conform's `onValidate`.
 */

/**
 * Concierge booking — POST to /concierge-book action.
 * Mirrors the API's `BookRequestSchema`
 * (api/src/lib/validations/concierge.schema.ts): contactName + address are
 * required (min 1), contactEmail must be a valid email, phone + notes optional.
 * The invite `token` and the chosen slot start/end come through hidden inputs
 * and are validated here too (slot start/end required) so the no-JS path is
 * safe; `token` itself is a URL passthrough re-sent as a hidden field.
 */
export const conciergeBookSchema = z.object({
  contactName: z
    .string()
    .min(1, "Your name is required")
    .max(200, "Name is too long"),
  contactEmail: z
    .string()
    .min(1, "Email is required")
    .email("Enter a valid email address")
    .max(200, "Email is too long"),
  contactPhone: z
    .string()
    .max(40, "Phone number is too long")
    .optional(),
  address: z
    .string()
    .min(1, "Property address is required")
    .max(500, "Address is too long"),
  slotStart: z.string().min(1, "Please choose a time slot"),
  slotEnd: z.string().min(1, "Please choose a time slot"),
  notes: z.string().optional(),
});

export type ConciergeBookInput = z.infer<typeof conciergeBookSchema>;
