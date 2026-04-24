import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

const PYTHON_VENV_PATH = "/home/frutak/price-checker/venv/bin/python3";
const HELPER_SCRIPT_PATH = "scripts/scrape_price_pw.py";

export type PricePlatform = "booking" | "airbnb" | "slowhop" | "alohacamp";
export type PropertyKey = "Sadoles" | "Hacjenda";

export interface PriceScrapeResult {
  price?: number;
  status?: "SOLD_OUT" | "MIN_STAY_VIOLATION" | "ERROR";
  error?: string;
}

export class PriceScraperService {
  /**
   * Fetches the price for a specific property and channel on given dates.
   * This uses the existing Playwright-stealth Python environment for robustness.
   */
  static async fetchPrice(
    platform: PricePlatform,
    property: PropertyKey,
    checkIn: string, // YYYY-MM-DD
    checkOut: string // YYYY-MM-DD
  ): Promise<PriceScrapeResult> {
    try {
      // Ensure we use absolute path for the helper script
      const scriptPath = path.resolve(HELPER_SCRIPT_PATH);
      
      const { stdout } = await execAsync(
        `${PYTHON_VENV_PATH} ${scriptPath} "${platform}" "${property}" "${checkIn}" "${checkOut}"`
      );

      const result = JSON.parse(stdout);
      
      if (result.error) {
        return { status: "ERROR", error: result.error };
      }

      return result;
    } catch (err) {
      console.error(`[PriceScraperService] Execution failed:`, err);
      return { 
        status: "ERROR", 
        error: (err as Error).message 
      };
    }
  }
}
