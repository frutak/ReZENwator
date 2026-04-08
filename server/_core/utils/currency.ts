
/**
 * Currency and price parsing utilities.
 */

/**
 * Parse price string: "1 800,00 PLN" or "2862 zł" or "2,451.25 zł" → number
 * Handles both dot and comma as decimal or thousands separators.
 */
export function parsePrice(priceStr: string): { amount: number; currency: string } | undefined {
  if (!priceStr) return undefined;
  const currency = priceStr.toLowerCase().includes("pln") || priceStr.includes("zł") || priceStr.includes("zl")
    ? "PLN"
    : "PLN";
    
  // Remove currency symbols and non-numeric/separator chars
  const cleaned = priceStr
    .replace(/[^\d,.\s]/g, "")
    .trim();

  // Remove all spaces
  const noSpaces = cleaned.replace(/\s/g, "");

  let amount: number;
  
  // Logic:
  // 1. Both separators exist: unambiguous
  if (noSpaces.includes(",") && noSpaces.includes(".")) {
    if (noSpaces.indexOf(",") < noSpaces.indexOf(".")) {
      // 1,234.56 (US style)
      amount = parseFloat(noSpaces.replace(/,/g, ""));
    } else {
      // 1.234,56 (EU style)
      amount = parseFloat(noSpaces.replace(/\./g, "").replace(",", "."));
    }
  } 
  // 2. Only comma exists
  else if (noSpaces.includes(",")) {
    const parts = noSpaces.split(",");
    if (parts.length > 2) {
      // Multiple commas: 1,000,000
      amount = parseFloat(noSpaces.replace(/,/g, ""));
    } else {
      // Single comma: 1,600 or 123,45
      const decimals = parts[1]!.length;
      if (decimals === 3) {
        // Assume thousands separator if exactly 3 digits after (e.g. 1,600)
        amount = parseFloat(noSpaces.replace(",", ""));
      } else {
        // Otherwise assume decimal separator (e.g. 123,45 or 1,5)
        amount = parseFloat(noSpaces.replace(",", "."));
      }
    }
  }
  // 3. Only dot exists
  else if (noSpaces.includes(".")) {
    const parts = noSpaces.split(".");
    if (parts.length > 2) {
      // Multiple dots: 1.000.000
      amount = parseFloat(noSpaces.replace(/\./g, ""));
    } else {
      // Single dot: 1.600 or 123.45
      const decimals = parts[1]!.length;
      if (decimals === 3) {
        // Assume thousands separator if exactly 3 digits after (e.g. 1.600)
        amount = parseFloat(noSpaces.replace(".", ""));
      } else {
        // Otherwise assume decimal separator (e.g. 123.45)
        amount = parseFloat(noSpaces);
      }
    }
  }
  else {
    amount = parseFloat(noSpaces);
  }

  return isNaN(amount) ? undefined : { amount, currency };
}
