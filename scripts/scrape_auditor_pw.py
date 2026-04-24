import sys
import json
import asyncio
import re
from playwright.async_api import async_playwright
from playwright_stealth import Stealth

# Specialized scraper for PricingAuditor worker
async def scrape_audit(platform, url, min_price, benchmark=None, nights=1):
    async with async_playwright() as pw:
        # Use firefox for variety and better stealth on some platforms
        browser = await pw.firefox.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/119.0"
        )
        page = await context.new_page()
        await Stealth().apply_stealth_async(page)

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
            # Give it more time for heavy JS sites like Airbnb
            await asyncio.sleep(8)
            
            content = await page.content()
            text = await page.inner_text("body")

            # Basic availability check
            sold_out_markers = ["brak wolnych", "sold out", "zajęty", "termin jest zajęty", "not available", "minimum stay"]
            if any(m in text.lower() for m in sold_out_markers):
                return {"price": None, "status": "SOLD_OUT"}

            # Regex for prices with spaces or NBSP
            price_patterns = [
                r'(\d[\d\s]{2,5})(?:\s?zł|PLN)',
                r'price.*?(\d[\d\s]{2,5})'
            ]
            
            found_prices = []
            for pattern in price_patterns:
                matches = re.findall(pattern, content, re.IGNORECASE)
                for m in matches:
                    try:
                        val = int(re.sub(r'[^\d]', '', m))
                        if float(min_price) <= val <= 40000:
                            found_prices.append(val)
                    except: continue

            if not found_prices:
                # Last resort: find all 4-5 digit numbers
                digits = re.findall(r'\b\d{4,5}\b', text)
                for d in digits:
                    val = int(d)
                    if float(min_price) <= val <= 40000:
                        found_prices.append(val)

            if found_prices:
                # If benchmark is provided, pick the price closest to it
                if benchmark:
                    target = float(benchmark)
                    best_price = min(found_prices, key=lambda x: abs(x - target))
                else:
                    best_price = max(found_prices)
                
                return {"price": best_price, "status": "OK"}
            
            return {"price": None, "status": "SOLD_OUT"}

        except Exception as e:
            return {"price": None, "status": "ERROR", "error": str(e)}
        finally:
            await browser.close()

if __name__ == "__main__":
    # Args: platform, url, min_price, [benchmark], [nights]
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Missing arguments"}))
        sys.exit(1)

    platform = sys.argv[1]
    url = sys.argv[2]
    min_price = sys.argv[3]
    benchmark = sys.argv[4] if len(sys.argv) > 4 else None
    nights = sys.argv[5] if len(sys.argv) > 5 else 1

    result = asyncio.run(scrape_audit(platform, url, min_price, benchmark, nights))
    print(json.dumps(result))
