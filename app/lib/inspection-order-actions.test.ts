/**
 * `pickOrderFields` is the allow-list that keeps the hub's four order editors
 * from becoming a general-purpose inspection PATCH.
 *
 * `UpdateInspectionSchema` also accepts `status`, `templateId`, `coverPhotoId`
 * and the property facts. Each of those has its own surface with its own rules
 * — the publish lifecycle owns `status`, the report editor owns the template —
 * so a schedule modal quietly carrying one through would be a real hole rather
 * than a style point.
 */
import { describe, it, expect } from "vitest";
import { pickOrderFields } from "./inspection-order-actions";

describe("pickOrderFields", () => {
  it("keeps every order fact the hub's cards edit", () => {
    const payload = {
      date: "2026-08-01T14:00:00.000Z",
      inspectorId: "u-1",
      price: 45000,
      closingDate: "2026-09-01",
      referenceNumber: "REF-1",
      referralSource: "Realtor",
      paymentRequired: true,
      agreementRequired: false,
    };
    expect(pickOrderFields(payload)).toEqual(payload);
  });

  it("drops fields that belong to another surface", () => {
    expect(
      pickOrderFields({
        price: 100,
        status: "completed",
        templateId: "tpl-1",
        coverPhotoId: "tenant/insp/x.jpg",
        requireDefectFieldsOverride: "both",
        propertyAddress: "somewhere else",
      }),
    ).toEqual({ price: 100 });
  });

  it("passes null through — it is how a cleared field reaches the API", () => {
    // `''` would be dropped by the shared settings sanitizer, which is exactly
    // why the editor sheet could never clear a reference number.
    expect(pickOrderFields({ referenceNumber: null, closingDate: null })).toEqual({
      referenceNumber: null,
      closingDate: null,
    });
  });

  it("omits absent keys so a one-field modal PATCHes one field", () => {
    expect(pickOrderFields({ agreementRequired: true })).toEqual({ agreementRequired: true });
  });
});
