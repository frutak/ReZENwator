import { describe, it, expect, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { GuestReplyRepository } from "../repositories/GuestReplyRepository";
import * as dbModule from "../db";

vi.mock("../db", () => ({ getDb: vi.fn() }));

/**
 * Renders the WHERE clause `findPendingDrafting` builds, so the test checks the
 * query itself rather than whatever a mocked database hands back.
 */
async function renderDraftingQuery(options: { limit: number; maxAttempts: number; retryReceivedSince: Date }) {
  let where: any;
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: (w: any) => {
      where = w;
      return chain;
    },
    orderBy: () => chain,
    limit: async () => [],
  };
  (dbModule.getDb as any).mockResolvedValue(chain);

  await GuestReplyRepository.findPendingDrafting(options);
  return new MySqlDialect().sqlToQuery(where);
}

describe("GuestReplyRepository.findPendingDrafting", () => {
  const since = new Date("2026-09-07T20:00:00Z");

  it("retries failed drafts received since the cutoff, not only new ones", async () => {
    const { sql, params } = await renderDraftingQuery({ limit: 20, maxAttempts: 5, retryReceivedSince: since });

    expect(sql).toMatch(/`status` = \? or \(`guest_reply_drafts`\.`status` = \? and `guest_reply_drafts`\.`receivedAt` >= \?\)/);
    // The timestamp column hands the driver a string, not the Date itself.
    expect(params).toEqual([5, "new", "failed", "2026-09-07 20:00:00.000"]);
  });

  it("stops at the attempt limit for every status", async () => {
    const { sql } = await renderDraftingQuery({ limit: 20, maxAttempts: 5, retryReceivedSince: since });

    expect(sql).toMatch(/^\(`guest_reply_drafts`\.`draftAttempts` < \? and \(/);
  });
});
