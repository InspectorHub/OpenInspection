// @vitest-environment node
/**
 * One server-side path deletes an inspection for both the list and the
 * inspection page. An inspection that is already gone is a success for the
 * person who asked for it gone; any other refusal carries the server's reason.
 */
import { describe, it, expect, vi } from "vitest";
import { deleteInspectionViaApi } from "~/lib/inspection-delete.server";

const apiAnswering = (status: number, body: unknown = {}) => {
  const $delete = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
  return { api: { inspections: { ":id": { $delete } } } as never, $delete };
};

describe("deleteInspectionViaApi", () => {
  it("calls DELETE /api/inspections/:id for the given id and reports success", async () => {
    const { api, $delete } = apiAnswering(200);
    expect(await deleteInspectionViaApi(api, "insp-1")).toMatchObject({ ok: true, intent: "delete" });
    expect($delete).toHaveBeenCalledWith({ param: { id: "insp-1" } });
  });

  it("treats 404 (already gone) as success", async () => {
    const { api } = apiAnswering(404, { error: { message: "Inspection not found" } });
    expect(await deleteInspectionViaApi(api, "insp-1")).toMatchObject({ ok: true, intent: "delete", error: undefined });
  });

  it("a refusal (403) is a failure that carries the server's message", async () => {
    const { api } = apiAnswering(403, { error: { message: "You cannot delete inspections" } });
    expect(await deleteInspectionViaApi(api, "insp-1")).toMatchObject({ ok: false, intent: "delete", error: "You cannot delete inspections" });
  });

  it("a server error (500) is a failure with a readable fallback message", async () => {
    const { api } = apiAnswering(500, null);
    const out = await deleteInspectionViaApi(api, "insp-1");
    expect(out.ok).toBe(false);
    expect(out.error).toBeTruthy();
  });

  it("a request that cannot be made at all is a failure, not a thrown error", async () => {
    const api = { inspections: { ":id": { $delete: () => { throw new TypeError("network"); } } } } as never;
    const out = await deleteInspectionViaApi(api, "insp-1");
    expect(out.ok).toBe(false);
    expect(out.error).toBeTruthy();
  });
});
