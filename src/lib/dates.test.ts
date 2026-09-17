import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { addDays, bookedOn, daysBetween, isIsoDate, monthStart, weekStart } from "./dates";

describe("bookedOn", () => {
  it("uses the Karachi calendar, not UTC", () => {
    // Karachi is UTC+5, so late-evening UTC is already the next day there.
    // Getting this wrong would file a transaction under the wrong period.
    assert.equal(bookedOn(new Date("2026-09-17T19:30:00Z")), "2026-09-18");
    assert.equal(bookedOn(new Date("2026-09-17T18:59:59Z")), "2026-09-17");
  });

  it("handles the start of the day", () => {
    assert.equal(bookedOn(new Date("2026-01-01T00:00:00Z")), "2026-01-01");
    // 23:00 UTC on 31 Dec is already 04:00 on 1 Jan in Karachi.
    assert.equal(bookedOn(new Date("2025-12-31T23:00:00Z")), "2026-01-01");
  });
});

describe("calendar arithmetic", () => {
  it("counts days across month and year boundaries", () => {
    assert.equal(daysBetween("2026-09-17", "2026-09-18"), 1);
    assert.equal(daysBetween("2026-09-30", "2026-10-01"), 1);
    assert.equal(daysBetween("2025-12-31", "2026-01-01"), 1);
    assert.equal(daysBetween("2026-09-18", "2026-09-17"), -1);
    assert.equal(daysBetween("2026-02-28", "2026-03-01"), 1, "2026 is not a leap year");
    assert.equal(daysBetween("2024-02-28", "2024-03-01"), 2, "2024 is a leap year");
  });

  it("adds days", () => {
    assert.equal(addDays("2026-09-30", 1), "2026-10-01");
    assert.equal(addDays("2026-01-01", -1), "2025-12-31");
    assert.equal(addDays("2026-09-17", 0), "2026-09-17");
  });

  it("finds period boundaries", () => {
    assert.equal(monthStart("2026-09-17"), "2026-09-01");
    // 17 Sep 2026 is a Thursday.
    assert.equal(weekStart("2026-09-17"), "2026-09-14");
    assert.equal(weekStart("2026-09-14"), "2026-09-14", "Monday is its own week start");
    assert.equal(weekStart("2026-09-20"), "2026-09-14", "Sunday belongs to the week before");
  });

  it("validates ISO dates", () => {
    assert.equal(isIsoDate("2026-09-17"), true);
    assert.equal(isIsoDate("17-09-2026"), false);
    assert.equal(isIsoDate("2026-9-7"), false);
    assert.equal(isIsoDate(""), false);
  });
});
