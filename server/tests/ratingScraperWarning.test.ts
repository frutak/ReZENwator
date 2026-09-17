import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMail = vi.fn().mockResolvedValue({ messageId: "<test>" });

vi.mock("../_core/email", () => ({
  GMAIL_USER: "app@example.com",
  getTransporter: () => ({ sendMail }),
  getRecipientForEmail: async () => "owner@example.com",
  sendAlertEmail: vi.fn(),
  sendGuestEmail: vi.fn(),
}));

import { sendConsolidatedAlertEmail } from "../workers/dailyAlerts";

function emptyData(overrides: Record<string, any> = {}) {
  return {
    stalePending: [],
    unreconciled: [],
    upcomingUnpaid: [],
    upcomingPendingDeposits: [],
    depositsToReturn: [],
    stalePortalPaid: [],
    bookingsMissingData: [],
    arrivalNotes: [],
    transitions: [],
    guestEmailSummary: { sentCount: 0, failedCount: 0, details: [] },
    failedSyncs: [],
    failedGuestEmails: [],
    latestSyncs: [],
    portalStats: [],
    ...overrides,
  } as any;
}

function lastMail() {
  return sendMail.mock.calls[sendMail.mock.calls.length - 1][0];
}

const ratingFailure = {
  source: "Rating Scraper",
  errorMessage: "Failed Sadoles alohacamp: [alohacamp] timeout of 15000ms exceeded",
  createdAt: new Date("2026-09-16T10:00:32Z"),
};

const realFailure = {
  source: "Email Poller",
  errorMessage: "IMAP connection refused",
  createdAt: new Date("2026-09-16T10:05:00Z"),
};

describe("daily report — a stale rating scrape is a warning, not an error", () => {
  beforeEach(() => {
    sendMail.mockClear();
  });

  it("reports a failed rating scrape under Warnings and keeps it out of the error count", async () => {
    await sendConsolidatedAlertEmail(
      emptyData({
        failedSyncs: [ratingFailure],
        latestSyncs: [{ source: "Rating Scraper", success: "false" }],
      })
    );

    const mail = lastMail();
    expect(mail.subject).toContain("0 errors");
    expect(mail.html).toContain("⚠️ Warnings (nothing broken)");
    expect(mail.html).toContain("Stale (not critical)");
    // It must not be dressed up as an outage that needs acting on.
    expect(mail.html).not.toContain("Persistent Sync Failures");
    expect(mail.html).toContain("System is healthy");
  });

  it("still treats a genuine sync failure as an error", async () => {
    await sendConsolidatedAlertEmail(
      emptyData({
        failedSyncs: [realFailure],
        latestSyncs: [{ source: "Email Poller", success: "false" }],
      })
    );

    const mail = lastMail();
    expect(mail.subject).toContain("1 errors");
    expect(mail.html).toContain("Persistent Sync Failures");
    expect(mail.html).toContain("IMAP connection refused");
    expect(mail.html).not.toContain("System is healthy");
  });

  it("does not let a rating warning mask a real failure reported in the same run", async () => {
    await sendConsolidatedAlertEmail(
      emptyData({
        failedSyncs: [ratingFailure, realFailure],
        latestSyncs: [
          { source: "Rating Scraper", success: "false" },
          { source: "Email Poller", success: "false" },
        ],
      })
    );

    const mail = lastMail();
    expect(mail.subject).toContain("1 errors");
    expect(mail.html).toContain("⚠️ Warnings (nothing broken)");
    expect(mail.html).toContain("Persistent Sync Failures");
    expect(mail.html).toContain("IMAP connection refused");
  });

  it("names the newest attempt whatever order the rows arrive in", async () => {
    const older = { ...ratingFailure, errorMessage: "older attempt", createdAt: new Date("2026-09-16T09:00:00Z") };
    await sendConsolidatedAlertEmail(
      emptyData({
        failedSyncs: [ratingFailure, older],
        latestSyncs: [{ source: "Rating Scraper", success: "false" }],
      })
    );

    const mail = lastMail();
    expect(mail.html).toContain("timeout of 15000ms exceeded");
    expect(mail.html).not.toContain("older attempt");
    expect(mail.html).toContain("2 attempt(s)");
  });
});
