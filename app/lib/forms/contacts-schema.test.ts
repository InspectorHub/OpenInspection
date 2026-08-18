// @vitest-environment node
import { describe, it, expect } from "vitest";
import { makeAddContactSchema } from "~/lib/forms/contacts.schema";

/**
 * Unit tests for the contacts add/edit form schema (C-7 Conform + Zod migration).
 *
 * The schema enforces:
 *   - name is required (min 1)
 *   - email is optional but must be a valid address when non-empty
 *   - empty-string email is coerced to undefined (so the action sends null)
 *   - phone and agency are always optional
 *   - type defaults to "client" when omitted
 */
describe("addContactSchema", () => {
  // --- name validation ---

  it("fails when name is empty", () => {
    const result = makeAddContactSchema().safeParse({ name: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const nameError = result.error.issues.find((i) => i.path.includes("name"));
      expect(nameError?.message).toBe("Name is required");
    }
  });

  it("fails when name is missing (undefined)", () => {
    const result = makeAddContactSchema().safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const nameError = result.error.issues.find((i) => i.path.includes("name"));
      expect(nameError).toBeDefined();
    }
  });

  // --- email validation ---

  it("fails when email is an invalid address", () => {
    const result = makeAddContactSchema().safeParse({ name: "Jane", email: "not-an-email" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const emailError = result.error.issues.find((i) => i.path.includes("email"));
      expect(emailError?.message).toBe("Enter a valid email");
    }
  });

  it("passes when email is empty string — coerced to undefined", () => {
    const result = makeAddContactSchema().safeParse({ name: "Jane", email: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeUndefined();
    }
  });

  it("passes when email is omitted entirely", () => {
    const result = makeAddContactSchema().safeParse({ name: "Jane" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeUndefined();
    }
  });

  it("passes with a valid email address", () => {
    const result = makeAddContactSchema().safeParse({ name: "Jane", email: "jane@realty.com" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("jane@realty.com");
    }
  });

  // --- type defaults ---

  it("defaults type to 'client' when omitted", () => {
    const result = makeAddContactSchema().safeParse({ name: "Jane" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("client");
    }
  });

  it("accepts type 'agent'", () => {
    const result = makeAddContactSchema().safeParse({ name: "Bob", type: "agent" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("agent");
    }
  });

  // The form enum is DERIVED from ROLE_KIND, so it holds every contact-party
  // kind the DB column and the API schema hold. The select offers "other";
  // a form schema that rejects it turns a rendered option into a save failure.
  it("accepts type 'other'", () => {
    const result = makeAddContactSchema().safeParse({ name: "Casey", type: "other" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("other");
    }
  });

  // Positive control for the case above: derivation must not degrade into
  // accepting anything. "owner" is a staff seat on the users.role axis, which
  // shares vocabulary with this one but is not a contact-party kind.
  it("rejects a value from the staff-seat axis ('owner')", () => {
    const result = makeAddContactSchema().safeParse({ name: "Bob", type: "owner" });
    expect(result.success).toBe(false);
  });

  // --- optional fields ---

  it("passes with phone and agency populated", () => {
    const result = makeAddContactSchema().safeParse({
      name: "Jane",
      phone: "(555) 123-4567",
      agency: "Sunrise Realty",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe("(555) 123-4567");
      expect(result.data.agency).toBe("Sunrise Realty");
    }
  });

  it("passes with all fields populated", () => {
    const result = makeAddContactSchema().safeParse({
      type: "agent",
      name: "Alice Agent",
      email: "alice@agency.com",
      phone: "555-0001",
      agency: "Top Realty",
    });
    expect(result.success).toBe(true);
  });
});
