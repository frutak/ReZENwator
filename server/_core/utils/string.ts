
/**
 * String manipulation and similarity utilities.
 */

/**
 * Calculates Levenshtein distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  const tmp = [];
  for (let i = 0; i <= a.length; i++) tmp[i] = [i];
  for (let j = 0; j <= b.length; j++) tmp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

/**
 * Normalizes a name for matching (lowercase, no special chars, remove honorifics and address parts).
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\sąśćęłńóśźżŁĄŚĆĘŃÓŚŹŻ]/g, " ") // replace non-word with space, including all Polish chars
    // Strip common honorifics
    .replace(/\b(pan|pani|mgr|dr|inż)\b/g, "")
    // Strip common Polish address parts that might appear in sender names
    .replace(/\b(ul|al|aleja|ulica|m|lok|os|pl|plac|nr|dom)\b/g, "")
    .replace(/\s+/g, " ") // collapse spaces
    .trim();
}
