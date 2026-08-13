import crypto from "crypto";

/**
 * Password hashing and verification.
 *
 * The stored format carries its own algorithm, so an old hash keeps working
 * while new ones are written stronger:
 *
 *   scrypt$<N>$<r>$<p>$<salt>$<hash>   current
 *   <salt>:<hash>                      legacy — PBKDF2-SHA512, 1000 iterations
 *
 * 1000 iterations was the whole cost of guessing a password against a leaked
 * database: current guidance for PBKDF2-SHA512 is around 210 000, and a modern
 * GPU walks a 1000-iteration hash at millions of guesses a second. scrypt is
 * used instead of a larger iteration count because it is memory-hard — raising
 * the cost for an attacker with a GPU far more than for the server checking one
 * login.
 *
 * Nothing has to be migrated up front: {@link needsRehash} tells the login path
 * when it is holding a legacy hash, and it can only rehash at the one moment the
 * plaintext is in hand anyway — a successful login.
 */

/**
 * ~64 MB and ~100 ms per hash on this machine. `maxmem` has to be raised
 * explicitly: Node's default ceiling is 32 MB and scrypt throws above it.
 */
const SCRYPT = { N: 2 ** 16, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem })
    .toString("hex");
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    if (stored.startsWith("scrypt$")) {
      const [, n, r, p, salt, hash] = stored.split("$");
      if (!n || !r || !p || !salt || !hash) return false;
      const expected = Buffer.from(hash, "hex");
      const actual = crypto.scryptSync(password, salt, expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: SCRYPT.maxmem,
      });
      // Constant-time: a plain === leaks how much of the hash matched through
      // how long the comparison took.
      return crypto.timingSafeEqual(expected, actual);
    }

    // Legacy PBKDF2 — kept only so existing accounts can still sign in once.
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const expected = Buffer.from(hash, "hex");
    const actual = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** True while the account still carries a hash weaker than what we write today. */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith("scrypt$");
}
