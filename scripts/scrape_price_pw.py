import sys
import json
import asyncio
from datetime import datetime, timedelta
from playwright.async_api import async_playwright
from playwright_stealth import Stealth

# Core logic for single-point price scraping used by PriceScraperService
async def scrape_price(platform, property_key, check_in, check_out):
    # Configuration matches what we discussed for Sadoleś and Hacjenda
    config = {
        "Sadoles": {
            "occ": "11", "aloha_occ": "11",
            "sh_id": "2256-sadoles-66", "air_id": "39273784", "book_id": "sadoles-66.pl",
            "aloha_id": "sadoles-66-4436", "min_nightly": 700, "cleaning": 900
        },
        "Hacjenda": {
            "occ": "4",
            "sh_id": "4575-hacjenda-kiekrz", "air_id": "1327633659929514853", "book_id": "hacienda-kiekrz",
            "min_nightly": 300, "cleaning": 700
        }
    }

    if property_key not in config:
        return {"error": f"Unknown property: {property_key}"}

    p = config[property_key]
    nights = (datetime.strptime(check_out, "%Y-%m-%d") - datetime.strptime(check_in, "%Y-%m-%d")).days
    min_exp = p["cleaning"] + (p["min_nightly"] * nights)

    url = ""
    if platform == "booking":
        url = f"https://www.booking.com/hotel/pl/{p['book_id']}.html?checkin={check_in}&checkout={check_out}&group_adults={p['occ']}"
    elif platform == "airbnb":
        url = f"https://www.airbnb.com/rooms/{p['air_id']}?check_in={check_in}&check_out={check_out}&adults={p['occ']}"
    elif platform == "slowhop":
        url = f"https://slowhop.com/pl/miejsca/{p['sh_id']}.html?adults={p['occ']}&start_date={check_in}&end_date={check_out}"
    elif platform == "alohacamp" and "aloha_id" in p:
        # Alohacamp uses T23:00 format for start/end in URLs sometimes, but the base works too
        url = f"https://alohacamp.com/pl/property/{p['aloha_id']}?adults_count={p['aloha_occ']}&start={check_in}&end={check_out}"
    else:
        return {"error": f"Unsupported platform: {platform}"}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36")
        page = await context.new_page()
        await Stealth().apply_stealth_async(page)

        try:
            await page.goto(url, wait_until="networkidle", timeout=60000)
            await asyncio.sleep(5)
            content = await page.content()
            text = await page.inner_text("body")

            # Check for sold out markers
            sold_out_markers = ["Brak wolnych", "Sold out", "zajęty", "termin jest zajęty", "Not available", "Brak dostępności"]
            if any(m.lower() in text.lower() for m in sold_out_markers):
                return {"status": "SOLD_OUT"}

            # Price extraction logic (v1.2 refined)
            # Find all numbers that look like prices
            import re
            prices = re.findall(r'(\d[\d\s]{2,5})(?:\s?zł|PLN|&nbsp;zł)', content)
            if not prices:
                # Fallback to pure digits if currency symbol not found
                prices = re.findall(r'\b\d{3,5}\b', text)

            valid_prices = []
            for pr in prices:
                clean_p = int(re.sub(r'[^\d]', '', pr))
                if min_exp <= clean_p <= 30000:
                    valid_prices.append(clean_p)

            if valid_prices:
                # Usually the highest price in the summary/sidebar is the total
                return {"price": max(valid_prices), "status": "OK"}
            
            return {"status": "SOLD_OUT"}

        except Exception as e:
            return {"error": str(e), "status": "ERROR"}
        finally:
            await browser.close()

if __name__ == "__main__":
    if len(sys.argv) < 5:
        print(json.dumps({"error": "Missing arguments"}))
        sys.exit(1)

    platform, property_key, check_in, check_out = sys.argv[1:5]
    result = asyncio.run(scrape_price(platform, property_key, check_in, check_out))
    print(json.dumps(result))
