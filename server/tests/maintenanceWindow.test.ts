import { describe, it, expect } from "vitest";
import { isNetworkMaintenanceWindow } from "../workers/scheduler";

/**
 * The nightly router/mesh window (02:50–03:20 Europe/Warsaw).
 *
 * Times are built as explicit UTC instants rather than local ones so the
 * assertions mean the same thing wherever the suite runs — the whole point of
 * the guard is that it tracks Warsaw, not the host clock.
 *
 * CEST (summer) is UTC+2, CET (winter) is UTC+1.
 */
describe("isNetworkMaintenanceWindow", () => {
  const at = (iso: string) => new Date(iso);

  describe("summer time (CEST, UTC+2)", () => {
    it("lets the 02:30 iCal tick through", () => {
      expect(isNetworkMaintenanceWindow(at("2026-08-12T00:30:00Z"))).toBe(false);
    });

    it("is closed one minute before the window opens (02:49)", () => {
      expect(isNetworkMaintenanceWindow(at("2026-08-12T00:49:00Z"))).toBe(false);
    });

    it("opens exactly at 02:50", () => {
      expect(isNetworkMaintenanceWindow(at("2026-08-12T00:50:00Z"))).toBe(true);
    });

    it("covers the 03:00 iCal tick", () => {
      expect(isNetworkMaintenanceWindow(at("2026-08-12T01:00:00Z"))).toBe(true);
    });

    it("covers the 03:05 email tick", () => {
      expect(isNetworkMaintenanceWindow(at("2026-08-12T01:05:00Z"))).toBe(true);
    });

    it("is closed at 03:20 — the end is exclusive", () => {
      expect(isNetworkMaintenanceWindow(at("2026-08-12T01:20:00Z"))).toBe(false);
    });

    it("lets the 03:30 iCal tick through", () => {
      expect(isNetworkMaintenanceWindow(at("2026-08-12T01:30:00Z"))).toBe(false);
    });

    it("lets the relocated 04:00 pricing audit through", () => {
      expect(isNetworkMaintenanceWindow(at("2026-08-12T02:00:00Z"))).toBe(false);
    });
  });

  describe("winter time (CET, UTC+1)", () => {
    it("still opens at 02:50 local, an hour later in UTC", () => {
      expect(isNetworkMaintenanceWindow(at("2026-01-15T01:50:00Z"))).toBe(true);
    });

    it("does not fire at the summer offset in winter", () => {
      // 00:50Z is 01:50 in Warsaw during CET — nowhere near the window.
      expect(isNetworkMaintenanceWindow(at("2026-01-15T00:50:00Z"))).toBe(false);
    });
  });

  it("stays closed across the rest of the day", () => {
    // Every half-hour tick outside 02:50–03:20 must be allowed to run.
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 5, 30, 35]) {
        const mins = h * 60 + m;
        const inWindow = mins >= 170 && mins < 200;
        const utc = new Date(Date.UTC(2026, 7, 12, h - 2, m)); // CEST offset
        expect(isNetworkMaintenanceWindow(utc), `${h}:${String(m).padStart(2, "0")}`).toBe(inWindow);
      }
    }
  });

  it("guards against a midnight hour rendered as 24", () => {
    // Some ICU builds emit "24" for midnight under hour12:false; the helper
    // normalises with % 24, so midnight must read as 00:00, not 24:00.
    expect(isNetworkMaintenanceWindow(at("2026-08-11T22:00:00Z"))).toBe(false);
  });
});
