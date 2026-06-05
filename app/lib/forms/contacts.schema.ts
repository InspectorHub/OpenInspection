import { z } from "zod";

/**
 * Form schema for the add/edit contact modal (contacts.tsx). Mirrors the field
 * set the form actually collects: type, name, email (optional), phone (optional),
 * agency (optional). Kept as plain zod (no `.openapi()`) so the SAME schema runs
 * in the action (`parseWithZod`) and in the browser via Conform's `onValidate` —
 * one validation source, progressive-enhancement safe.
 *
 * Field set (from the ContactModal form):
 *   - type    — "client" | "agent", select, defaults to "client"
 *   - name    — required free-text
 *   - email   — optional; empty string coerced to undefined so the API receives null
 *   - phone   — optional free-text (tel input)
 *   - agency  — optional free-text
 */
export const addContactSchema = z.object({
  type: z.enum(["client", "agent"]).default("client"),
  name: z.string().min(1, "Name is required"),
  email: z
    .string()
    .email("Enter a valid email")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  phone: z.string().optional(),
  agency: z.string().optional(),
});

export type AddContactInput = z.infer<typeof addContactSchema>;
