/**
 * In-memory rate limiting.
 *
 * One process serves this app — there is no second instance to coordinate with —
 * so a map is the whole mechanism. The trade is stated plainly: counters reset
 * on restart. That is acceptable for what they guard (slowing a guesser down,
 * capping how fast one visitor can fill the calendar) and would not be for
 * anything that must hold across a deploy.
 */

type Attempt = { count: number; first: number; blockedUntil: number };

const buckets = new Map<string, Map<string, Attempt>>();

function bucket(name: string): Map<string, Attempt> {
  let b = buckets.get(name);
  if (!b) {
    b = new Map();
    buckets.set(name, b);
  }
  return b;
}

/** Drops entries whose window has passed, so the map cannot grow without bound. */
function sweep(b: Map<string, Attempt>, windowMs: number, now: number) {
  for (const [key, a] of b) {
    if (now - a.first > windowMs && a.blockedUntil < now) b.delete(key);
  }
}

export interface LimitOptions {
  /** How many events are allowed inside the window. */
  max: number;
  windowMs: number;
  /** How long the key is refused once it goes over. */
  blockMs: number;
}

export interface LimitResult {
  allowed: boolean;
  /** Seconds until the key is accepted again — for the message shown to the user. */
  retryAfterSec: number;
  remaining: number;
}

/**
 * Counts an event against `key` and says whether it is allowed.
 *
 * Call it only where the event should count. For a login that means counting
 * failures, not attempts: someone typing their own password correctly ten times
 * in a row is not an attack.
 */
export function hit(name: string, key: string, opts: LimitOptions, now = Date.now()): LimitResult {
  const b = bucket(name);
  sweep(b, opts.windowMs, now);

  const existing = b.get(key);

  if (existing && existing.blockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((existing.blockedUntil - now) / 1000), remaining: 0 };
  }

  if (!existing || now - existing.first > opts.windowMs) {
    b.set(key, { count: 1, first: now, blockedUntil: 0 });
    return { allowed: true, retryAfterSec: 0, remaining: opts.max - 1 };
  }

  existing.count += 1;
  if (existing.count > opts.max) {
    existing.blockedUntil = now + opts.blockMs;
    return { allowed: false, retryAfterSec: Math.ceil(opts.blockMs / 1000), remaining: 0 };
  }

  return { allowed: true, retryAfterSec: 0, remaining: opts.max - existing.count };
}

/** Forgets a key — a successful login clears the failures that preceded it. */
export function clear(name: string, key: string): void {
  buckets.get(name)?.delete(key);
}

/** Test seam. */
export function resetAll(): void {
  buckets.clear();
}
