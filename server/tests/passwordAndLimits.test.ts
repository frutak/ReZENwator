import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { hashPassword, verifyPassword, needsRehash } from "../_core/password";
import { hit, clear, resetAll } from "../_core/rateLimit";

/**
 * Passwords were hashed with PBKDF2-SHA512 at 1000 iterations — roughly a
 * thousandth of current guidance, and a rate a GPU chews through. The stored
 * format now names its algorithm so an old hash keeps working until its owner
 * next signs in, which is the only moment the plaintext exists to upgrade it.
 */
describe("password hashing", () => {
  it("accepts the right password and rejects the wrong one", () => {
    const stored = hashPassword("prawidłowe hasło");
    expect(verifyPassword("prawidłowe hasło", stored)).toBe(true);
    expect(verifyPassword("prawidłowe hasl0", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  it("salts, so the same password twice gives two different hashes", () => {
    expect(hashPassword("to samo")).not.toBe(hashPassword("to samo"));
  });

  it("still lets a legacy account sign in", () => {
    // Exactly what the old code wrote: salt:hash, PBKDF2, 1000 iterations.
    const salt = crypto.randomBytes(16).toString("hex");
    const legacy = `${salt}:${crypto.pbkdf2Sync("stare hasło", salt, 1000, 64, "sha512").toString("hex")}`;

    expect(verifyPassword("stare hasło", legacy)).toBe(true);
    expect(verifyPassword("inne hasło", legacy)).toBe(false);
  });

  it("flags a legacy hash for upgrade and leaves a current one alone", () => {
    const salt = crypto.randomBytes(16).toString("hex");
    const legacy = `${salt}:${crypto.pbkdf2Sync("x", salt, 1000, 64, "sha512").toString("hex")}`;

    expect(needsRehash(legacy)).toBe(true);
    expect(needsRehash(hashPassword("x"))).toBe(false);
  });

  it("survives a corrupted or empty stored value without throwing", () => {
    for (const junk of ["", "brak-separatora", "scrypt$", "scrypt$1$2$3", "a:b"]) {
      expect(verifyPassword("cokolwiek", junk)).toBe(false);
    }
  });

  it("costs enough to be worth an attacker's time", () => {
    // Not a benchmark — a floor. If someone lowers the work factor to make
    // logins snappier, this is what notices.
    const started = Date.now();
    hashPassword("pomiar");
    expect(Date.now() - started).toBeGreaterThan(15);
  });
});

/**
 * Login throttling and the cap on the public booking form. One process serves
 * this app, so the counters live in memory; they reset on restart, which is
 * acceptable for slowing a guesser but is the reason this is not the only
 * defence.
 */
describe("rate limiting", () => {
  const opts = { max: 3, windowMs: 60_000, blockMs: 300_000 };

  beforeEach(() => resetAll());

  it("allows up to the limit, then blocks", () => {
    expect(hit("t", "k", opts).allowed).toBe(true);
    expect(hit("t", "k", opts).allowed).toBe(true);
    expect(hit("t", "k", opts).allowed).toBe(true);
    const blocked = hit("t", "k", opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(300);
  });

  it("keeps keys apart, so one guessed account cannot lock out another", () => {
    for (let i = 0; i < 5; i++) hit("t", "ofiara", opts);
    expect(hit("t", "ofiara", opts).allowed).toBe(false);
    expect(hit("t", "ktoś-inny", opts).allowed).toBe(true);
  });

  it("forgets a key on success, so mistyping then succeeding costs nothing", () => {
    hit("t", "k", opts);
    hit("t", "k", opts);
    clear("t", "k");
    expect(hit("t", "k", opts).remaining).toBe(opts.max - 1);
  });

  it("lets a key back in once the block has passed", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) hit("t", "k", opts, t0);
    expect(hit("t", "k", opts, t0).allowed).toBe(false);
    expect(hit("t", "k", opts, t0 + opts.blockMs + 1).allowed).toBe(true);
  });

  it("starts a fresh window rather than counting attempts forever", () => {
    const t0 = 2_000_000;
    hit("t", "k", opts, t0);
    hit("t", "k", opts, t0);
    // Long after the window: the earlier attempts are no longer evidence.
    const later = hit("t", "k", opts, t0 + opts.windowMs + 1);
    expect(later.allowed).toBe(true);
    expect(later.remaining).toBe(opts.max - 1);
  });
});
