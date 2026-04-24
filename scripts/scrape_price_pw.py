import sys
import json
import asyncio
import re
import random
from datetime import datetime, timedelta
from playwright.async_api import async_playwright
from playwright_stealth import Stealth

# Refined helper to extract all valid prices from text and return the largest one
def extract_best_price(text, min_p):
    if not text: return None
    # Allow commas and dots in the price part
    matches = re.findall(r'(\d[\d\s\xa0,.]+?)(?:\s?zł|PLN)', text, re.IGNORECASE)
    valid_values = []
    for m in matches:
        try:
            # Clean up: remove spaces, nbsp
            m_clean = m.replace('\xa0', '').replace(' ', '')
            # Handle decimals: if the string ends with a separator followed by 2 digits, remove them
            if len(m_clean) > 3 and m_clean[-3] in [',', '.']:
                val_str = m_clean[:-3].replace(',', '').replace('.', '')
            else:
                val_str = m_clean.replace(',', '').replace('.', '')

            if not val_str: continue
            val = int(val_str)
            if val in [2024, 2025, 2026, 2027]: continue
            if float(min_p) <= val <= 40000:
                valid_values.append(val)
        except: pass
    
    # Return the LAST valid value found, as it's typically the final total or the new price after a discount
    return valid_values[-1] if valid_values else None

async def scrape_price(platform, property_key, check_in, check_out):
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
    elif platform == "alohacamp":
        url = f"https://alohacamp.com/pl/property/{p['aloha_id']}?adults_count={p['aloha_occ']}&start={check_in}&end={check_out}"

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        
        ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
        if platform == "airbnb":
            ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

        context = await browser.new_context(user_agent=ua)
        page = await context.new_page()
        await Stealth().apply_stealth_async(page)

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
            await asyncio.sleep(random.uniform(8, 12))
            
            # Validation
            if platform == "slowhop":
                if check_in not in page.url or check_out not in page.url:
                    return {"status": "SOLD_OUT"}
            elif platform == "alohacamp":
                 if check_in[:7] not in page.url:
                    return {"status": "SOLD_OUT"}
            elif platform == "booking":
                 if p['book_id'] not in page.url:
                    return {"status": "SOLD_OUT"}

            text = await page.inner_text("body")

            # 1. Availability Check
            sold_out_markers = [
                "brak wolnych pokoi", "nie znaleźliśmy ofert", "sold out", "termin jest zajęty", 
                "not available", "minimum stay", "pobyt minimalny",
                "wybrany termin jest zajęty", "zapytaj o inny termin", "brak miejsc",
                "wybierz daty", "wpisz daty", "zobacz dostępność"
            ]
            
            if platform == "booking":
                if "minimum stay" in text.lower() or "pobyt minimalny" in text.lower():
                    return {"status": "SOLD_OUT"}
                if "wybierz daty" in text.lower() or "zobacz dostępność" in text.lower():
                     if not await page.locator(".prco-valign-middle-helper").first.is_visible(timeout=1000):
                         return {"status": "SOLD_OUT"}

            if any(m.lower() in text.lower() for m in sold_out_markers):
                any_price = False
                if platform == "booking":
                    any_price = await page.locator(".prco-valign-middle-helper").first.is_visible(timeout=1000)
                
                if not any_price and not extract_best_price(text, min_exp):
                    return {"status": "SOLD_OUT"}

            # 2. Pinpoint Price
            found_price = None
            if platform == "booking":
                selectors = [".prco-valign-middle-helper", "[data-testid='price-and-pos-availability']", ".bui-price-display__value"]
                for sel in selectors:
                    elements = page.locator(sel)
                    if await elements.count() > 0:
                        found_price = extract_best_price(" ".join(await elements.all_inner_texts()), min_exp)
                        if found_price: break
            elif platform == "airbnb":
                selectors = [
                    "span._1y74zjx", 
                    "div[data-testid='book-it-default']",
                    "[data-section-id='BOOK_IT_SIDEBAR']",
                    "span:has-text('zł total')",
                    "div:has-text('Łącznie') + div"
                ]
                for sel in selectors:
                    el = page.locator(sel).first
                    if await el.is_visible(timeout=3000):
                        found_price = extract_best_price(await el.inner_text(), min_exp)
                        if found_price: break
            elif platform == "slowhop":
                selectors = [".price-summary-row--main", ".price-summary-row__value", ".summary-price", ".total-amount"]
                for sel in selectors:
                    el = page.locator(sel).last
                    if await el.is_visible(timeout=3000):
                        found_price = extract_best_price(await el.inner_text(), min_exp)
                        if found_price: break
            elif platform == "alohacamp":
                selectors = ["[data-testid='price-summary-total-price']", ".price-total", "div:has-text('Ostateczna cena')", "div:has-text('Razem')"]
                for sel in selectors:
                    el = page.locator(sel).first
                    if await el.is_visible(timeout=3000):
                        found_price = extract_best_price(await el.inner_text(), min_exp)
                        if found_price: break

            if found_price:
                return {"price": found_price, "status": "OK"}
            
            return {"status": "SOLD_OUT"}

        except Exception as e:
            return {"error": str(e), "status": "ERROR"}
        finally:
            await browser.close()

if __name__ == "__main__":
    if len(sys.argv) < 5:
        sys.exit(1)
    platform, property_key, check_in, check_out = sys.argv[1:5]
    result = asyncio.run(scrape_price(platform, property_key, check_in, check_out))
    print(json.dumps(result))
