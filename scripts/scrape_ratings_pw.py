import sys
import json
import asyncio
import re
from playwright.async_api import async_playwright
from playwright_stealth import Stealth

async def scrape_ratings(property_name):
    urls = {
        "Sadoles": "https://www.booking.com/hotel/pl/sadoles-66.html",
        "Hacjenda": "https://www.booking.com/hotel/pl/hacienda-kiekrz.html"
    }
    
    if property_name not in urls:
        return {"error": "Unknown property"}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()
        await Stealth().apply_stealth_async(page)
        
        try:
            await page.goto(urls[property_name], wait_until="networkidle")
            
            # Booking.com rating selector
            rating_el = page.locator("[data-testid='review-score-component'] div:first-child").first
            count_el = page.locator("[data-testid='review-score-component'] div:last-child").first
            
            rating = await rating_el.inner_text() if await rating_el.count() > 0 else "N/A"
            count = await count_el.inner_text() if await count_el.count() > 0 else "0"
            
            # Clean up count (e.g., "123 opinie" -> 123)
            count_num = re.sub(r'[^\d]', '', count)
            
            return {
                "property": property_name,
                "rating": rating.strip(),
                "reviews_count": int(count_num) if count_num else 0,
                "status": "OK"
            }
        except Exception as e:
            return {"error": str(e), "status": "ERROR"}
        finally:
            await browser.close()

if __name__ == "__main__":
    prop = sys.argv[1] if len(sys.argv) > 1 else "Sadoles"
    print(json.dumps(asyncio.run(scrape_ratings(prop))))
