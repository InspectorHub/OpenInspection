// @vitest-environment node
/**
 * F42 — the date rules the bare `<input type="date">` did not have.
 *
 * The measured failure: `2020-01-05` (Sunday, six years past) produced no client
 * message, left Continue enabled, reached the confirm step and was printed back
 * as `2020-01-05`. Only the server refused it, and it named the wrong field.
 */
import { describe, it, expect } from "vitest";
import {
    validateBookingDate,
    todayCivil,
    addDaysCivil,
    formatBookingDate,
    BOOKING_HORIZON_DAYS,
} from "~/components/booking/booking-date-rules";

const TODAY = "2026-09-11";

describe("validateBookingDate", () => {
    it("refuses the date from the walkthrough", () => {
        expect(validateBookingDate("2020-01-05", { today: TODAY })).toBe("past");
    });

    it("refuses yesterday, not just years ago", () => {
        expect(validateBookingDate("2026-09-10", { today: TODAY })).toBe("past");
    });

    it("accepts today", () => {
        // An inspection booked for this afternoon is an ordinary request. Whether
        // a slot is still open today is the company's lead-time rule, answered
        // by the slots endpoint, not a calendar question.
        expect(validateBookingDate(TODAY, { today: TODAY })).toBeNull();
    });

    it("accepts a date inside the horizon and refuses one past it", () => {
        expect(validateBookingDate("2027-01-15", { today: TODAY })).toBeNull();
        expect(validateBookingDate(addDaysCivil(TODAY, BOOKING_HORIZON_DAYS), { today: TODAY })).toBeNull();
        expect(validateBookingDate(addDaysCivil(TODAY, BOOKING_HORIZON_DAYS + 1), { today: TODAY })).toBe("too-far");
        // The typo class: a year mistyped into the next century.
        expect(validateBookingDate("2062-09-11", { today: TODAY })).toBe("too-far");
    });

    it("treats a malformed value as invalid, and an empty one as unanswered", () => {
        expect(validateBookingDate("09/11/2026", { today: TODAY })).toBe("invalid");
        expect(validateBookingDate("2026-9-1", { today: TODAY })).toBe("invalid");
        // Empty is the initial state of the field; Continue is held by the step's
        // own required-fields check, and an error here would accuse the visitor
        // of a mistake they have not made yet.
        expect(validateBookingDate("", { today: TODAY })).toBeNull();
    });
});

describe("todayCivil", () => {
    it("reads the viewer's own calendar day, not the UTC one", () => {
        // 2026-09-11 23:30 at UTC+13 is still the 11th locally while UTC has
        // moved on — and the reverse for a western zone. The local parts are
        // what the native picker compares `min` against.
        const local = new Date(2026, 8, 11, 23, 30);
        expect(todayCivil(local)).toBe("2026-09-11");
        const early = new Date(2026, 0, 1, 0, 5);
        expect(todayCivil(early)).toBe("2026-01-01");
    });
});

describe("addDaysCivil", () => {
    it("crosses months, years and a leap day", () => {
        expect(addDaysCivil("2026-09-11", 1)).toBe("2026-09-12");
        expect(addDaysCivil("2026-09-30", 1)).toBe("2026-10-01");
        expect(addDaysCivil("2026-12-31", 1)).toBe("2027-01-01");
        expect(addDaysCivil("2028-02-28", 1)).toBe("2028-02-29");
        expect(addDaysCivil("2026-09-11", -1)).toBe("2026-09-10");
    });
});

describe("formatBookingDate", () => {
    it("puts the weekday on it, so a Sunday is visible", () => {
        const out = formatBookingDate("2020-01-05", "en-US");
        expect(out).toMatch(/Sunday/);
        expect(out).toMatch(/2020/);
        // The raw ISO string must not be what the visitor reads (F44).
        expect(out).not.toBe("2020-01-05");
    });

    it("reads in the visitor's language", () => {
        expect(formatBookingDate("2020-01-05", "es-419")).toMatch(/domingo/i);
    });

    it("does not shift the day for any viewer", () => {
        // The civil date is anchored and formatted in UTC; a zone-sensitive
        // rendering would print the 4th for anyone west of Greenwich.
        expect(formatBookingDate("2020-01-05", "en-US")).toMatch(/January 5, 2020/);
    });

    it("returns a non-date value untouched rather than inventing one", () => {
        expect(formatBookingDate("", "en-US")).toBe("");
        expect(formatBookingDate("not-a-date", "en-US")).toBe("not-a-date");
    });
});
