import axios from "axios";
import { exec } from "child_process";
import { promisify } from "util";
import { PropertyRepository } from "../repositories/PropertyRepository";
import { propertyRatings } from "../../drizzle/schema";
import { Logger } from "../_core/logger";

const execAsync = promisify(exec);

const RATING_URLS = {
  Sadoles: {
    booking: "https://www.booking.com/hotel/pl/sadoles-66.html",
    slowhop: "https://slowhop.com/pl/miejsca/2256-sadoles-66.html",
    airbnb: "https://www.airbnb.com/rooms/39273784",
    alohacamp: "https://alohacamp.com/pl/property/sadoles-66-4436",
  },
  Hacjenda: {
    booking: "https://www.booking.com/hotel/pl/hacienda-kiekrz.html",
    slowhop: "https://slowhop.com/pl/miejsca/4575-hacjenda-kiekrz.html",
    airbnb: "https://www.airbnb.com/rooms/1327633659929514853",
    google: "https://www.google.com/search?q=Hacjenda+Kiekrz+Reviews&tbm=lcl",
  },
};

const PYTHON_VENV_PATH = "/home/frutak/price-checker/venv/bin/python3";
const HELPER_SCRIPT_PATH = "scripts/scrape_ratings_pw.py";

async function scrapeWithPlaywright(url: string): Promise<{ rating: number; count: number } | null> {
  try {
    const { stdout } = await execAsync(`${PYTHON_VENV_PATH} ${HELPER_SCRIPT_PATH} "${url}"`);
    const result = JSON.parse(stdout);
    if (result.rating && result.count) {
      return { rating: result.rating, count: result.count };
    }
    if (result.error) {
      console.warn(`[RatingScraper] Playwright helper error: ${result.error}`);
    }
  } catch (err) {
    console.warn(`[RatingScraper] Failed to run Playwright helper:`, (err as any).message);
  }
  return null;
}

async function scrapePortal(property: "Sadoles" | "Hacjenda", url: string, portal: "booking" | "airbnb" | "slowhop" | "alohacamp" | "google"): Promise<{ rating: number; count: number } | null> {
  // 1. Try Playwright first (most robust, handles JS, Stealth, and generic fallbacks)
  const pwResult = await scrapeWithPlaywright(url);
  if (pwResult) return pwResult;

  // 2. Fallback to axios if Playwright fails
  try {
    const { data: html } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      },
      timeout: 15000,
    });

    if (html.includes("AwsWafIntegration") || html.includes("captcha")) {
      throw new Error("Blocked by WAF/Captcha");
    }

    // 1. Try JSON-LD (Standardized and most reliable)
    const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
    if (jsonLdMatches) {
      for (const script of jsonLdMatches) {
        try {
          const content = script.replace(/<script.*?>|<\/script>/g, "").trim();
          const data = JSON.parse(content);
          
          // JSON-LD can be a single object or an array
          const items = Array.isArray(data) ? data : [data];
          for (const item of items) {
            const ratingObj = item.aggregateRating || (item["@type"] === "AggregateRating" ? item : null);
            if (ratingObj) {
              const rating = parseFloat(String(ratingObj.ratingValue).replace(",", "."));
              const count = parseInt(String(ratingObj.reviewCount || ratingObj.ratingCount), 10);
              if (!isNaN(rating) && !isNaN(count)) return { rating, count };
            }
          }
        } catch (e) { /* ignore parse error for specific block */ }
      }
    }

    // 2. Try Meta tags (Common fallback)
    const metaDescription = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i) ||
                           html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/i);
    
    if (metaDescription) {
      const content = metaDescription[1];
      // Airbnb specific meta: "★4.97 · 36 reviews"
      const airbnbMatch = content.match(/★\s*(\d+[\.,]\d+)\s*·\s*(\d+)\s*(opinii|reviews|reviews)/i);
      if (airbnbMatch) {
        return { rating: parseFloat(airbnbMatch[1].replace(",", ".")), count: parseInt(airbnbMatch[2], 10) };
      }
      // Booking specific meta: "Scored 9.2 from 5 reviews"
      const bookingMatch = content.match(/(\d+[\.,]\d+)\s*\/\s*10/i) || content.match(/Scored\s+(\d+[\.,]\d+)/i);
      const countMatch = content.match(/(\d+)\s+(reviews|guest reviews|opinii)/i);
      if (bookingMatch && countMatch) {
        return { rating: parseFloat(bookingMatch[1].replace(",", ".")), count: parseInt(countMatch[1], 10) };
      }
    }

    // 3. Fallback to Regex patterns if JSON-LD/Meta fails
    if (portal === "booking") {
      const ratingMatch = html.match(/class="[^"]*score_value[^"]*">(\d+[\.,]\d+)<\/div>/i) || 
                          html.match(/data-testid="review-score-component".*?>(\d+[\.,]\d+)<\/div>/i);
      const countMatch = html.match(/class="[^"]*review_count[^"]*">(\d+)\s*(opinii|reviews)/i) || 
                         html.match(/(\d+)\s+guest\s+reviews/i);
      if (ratingMatch && countMatch) {
        return { rating: parseFloat(ratingMatch[1].replace(",", ".")), count: parseInt(countMatch[1], 10) };
      }
    } else if (portal === "slowhop") {
      const ratingMatch = html.match(/>(\d[\.,]\d)<\/span><span[^>]*>.*?<\/span><span[^>]*>Liczba opinii:/) ||
                          html.match(/(\d[\.,]\d)\/5/);
      const countMatch = html.match(/Liczba opinii:\s+(\d+)/) || html.match(/(\d+)\s+opinii/);
      if (ratingMatch && countMatch) {
        return { rating: parseFloat(ratingMatch[1].replace(",", ".")), count: parseInt(countMatch[1], 10) };
      }
    } else if (portal === "airbnb") {
      const ratingMatch = html.match(/"rating":(\d+[\.,]\d+)/) || html.match(/"avgRating":(\d+[\.,]\d+)/);
      const countMatch = html.match(/"reviewCount":(\d+)/) || html.match(/"reviewsCount":(\d+)/);
      if (ratingMatch && countMatch) {
        return { rating: parseFloat(ratingMatch[1].replace(",", ".")), count: parseInt(countMatch[1], 10) };
      }
    } else if (portal === "google") {
      const ratingMatch = html.match(/(\d[\.,]\d)\s+gwiazd/i) || html.match(/(\d[\.,]\d)\s+stars/i) || html.match(/(\d[\.,]\d)\(/);
      const countMatch = html.match(/(\d+)\s+opinii/i) || html.match(/(\d+)\s+reviews/i) || html.match(/\((\d+)\)/);
      if (ratingMatch && countMatch) {
        return { rating: parseFloat(ratingMatch[1].replace(",", ".")), count: parseInt(countMatch[1], 10) };
      }
    }
  } catch (error) {
    throw new Error(`[${portal}] ${(error as any).message}`);
  }
  
  throw new Error(`[${portal}] Could not find rating data in response`);
}

export async function updateAllPropertyRatings() {
  console.log("[RatingScraper] Starting ratings update...");
  const start = Date.now();
  const errors: string[] = [];

  for (const [property, portals] of Object.entries(RATING_URLS)) {
    for (const [portal, url] of Object.entries(portals)) {
      try {
        const result = await scrapePortal(property as any, url, portal as any);
        if (result) {
          console.log(`[RatingScraper] ${property} on ${portal}: ${result.rating} (${result.count} reviews)`);
          await PropertyRepository.upsertPropertyRating({
            property: property as any,
            portal: portal as any,
            rating: String(result.rating),
            count: result.count,
          });
        }
      } catch (error) {
        const msg = `Failed ${property} ${portal}: ${(error as Error).message}`;
        console.warn(`[RatingScraper] ${msg}`);
        errors.push(msg);
      }
    }
  }
  
  await Logger.system("ical", { 
    source: "Rating Scraper",
    success: errors.length === 0,
    errorMessage: errors.length > 0 ? errors.join("; ") : null,
    durationMs: Date.now() - start,
  });

  console.log(`[RatingScraper] Ratings update finished with ${errors.length} errors.`);
  if (errors.length > 0) {
    // We throw at the end so the TRPC caller knows it wasn't perfectly successful,
    // but the ones that did work are already saved.
    throw new Error(`Rating update encountered errors: ${errors.slice(0, 2).join(", ")}...`);
  }
}

