// @vitest-environment node
import { describe, expect, it } from "vitest";
import { INSPECTION_STATUS } from "~/lib/status";
import { INSPECTION_STATUS_COMPLETED } from "@core/field-ui/shared/inspection-status";

describe("field-ui inspection status constant", () => {
    it("equals the server's COMPLETED status", () => {
        console.info(`package: ${INSPECTION_STATUS_COMPLETED}; server: ${INSPECTION_STATUS.COMPLETED}`);
        expect(INSPECTION_STATUS_COMPLETED).toBe(INSPECTION_STATUS.COMPLETED);
        // Paired control: a different server status must not be what the package carries.
        expect(INSPECTION_STATUS_COMPLETED).not.toBe(INSPECTION_STATUS.SCHEDULED);
    });
});
