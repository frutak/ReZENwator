import sys
import json
import asyncio
import re
import random
from playwright.async_api import async_playwright
from playwright_stealth import Stealth

# Refined helper to extract all valid prices from text and return the largest one
def extract_best_price(text, min_p):
    if not text: return None
    # Allow commas and dots in the price part, and optionally allow text after currency
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

async def scrape_audit(platform, url, min_price, benchmark=None, nights=1):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        
        # User Agent switching for Airbnb to potentially bypass bot detection
        ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
        if platform == "airbnb":
            # Try a mobile User Agent for Airbnb
            ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

        context = await browser.new_context(user_agent=ua)
        page = await context.new_page()
        await Stealth().apply_stealth_async(page)

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
            # Randomized delay
            await asyncio.sleep(random.uniform(8, 12))
            
            text = await page.inner_text("body")
            
            # 1. Platform-specific validation / Redirection check
            if platform == "slowhop":
                expected_start = re.search(r'start_date=([\d-]+)', url)
                if expected_start and expected_start.group(1) not in page.url:
                    return {"price": None, "status": "SOLD_OUT"}
            elif platform == "alohacamp":
                 expected_start = re.search(r'start=([\d-]+)', url)
                 if expected_start and expected_start.group(1)[:7] not in page.url: 
                    return {"price": None, "status": "SOLD_OUT"}
            elif platform == "booking":
                 if "minimum stay" in text.lower() or "pobyt minimalny" in text.lower():
                     return {"price": None, "status": "SOLD_OUT"}
                 if "wybierz daty" in text.lower() and not await page.locator(".prco-valign-middle-helper").first.is_visible(timeout=1000):
                     return {"price": None, "status": "SOLD_OUT"}

            # 2. Availability Check (Markers)
            sold_out_markers = [
                "brak wolnych pokoi", "nie znaleźliśmy ofert", "sold out", "termin jest zajęty", 
                "not available", "minimum stay", "pobyt minimalny",
                "wybrany termin jest zajęty", "zapytaj o inny termin", "brak miejsc",
                "wybierz daty", "wpisz daty", "zobacz dostępność"
            ]
            
            if any(m in text.lower() for m in sold_out_markers):
                any_price = False
                if platform == "booking":
                    any_price = await page.locator(".prco-valign-middle-helper").first.is_visible(timeout=1000)
                
                if not any_price:
                    return {"price": None, "status": "SOLD_OUT"}

            # 3. Pinpoint Price by Platform Selectors
            found_price = None
            
            if platform == "booking":
                selectors = [".prco-valign-middle-helper", "[data-testid='price-and-pos-availability']", ".bui-price-display__value"]
                for sel in selectors:
                    elements = page.locator(sel)
                    if await elements.count() > 0:
                        combined_text = " ".join(await elements.all_inner_texts())
                        found_price = extract_best_price(combined_text, min_price)
                        if found_price: break

            elif platform == "airbnb":
                # Extended selectors for mobile and desktop versions
                selectors = [
                    "span._1y74zjx", # Total price span
                    "div[data-testid='book-it-default']",
                    "[data-section-id='BOOK_IT_SIDEBAR']",
                    "span:has-text('zł total')",
                    "div:has-text('Łącznie') + div"
                ]
                for sel in selectors:
                    el = page.locator(sel).first
                    if await el.is_visible(timeout=2000):
                        found_price = extract_best_price(await el.inner_text(), min_price)
                        if found_price: break

            elif platform == "slowhop":
                selectors = [
                    ".price-summary-row--main", 
                    ".price-summary-row__value", 
                    ".summary-price", 
                    ".total-amount",
                    "div:has-text('Łącznie') + div",
                    "div:has-text('Łącznie') ~ div"
                ]
                for sel in selectors:
                    el = page.locator(sel).last
                    if await el.is_visible(timeout=2000):
                        found_price = extract_best_price(await el.inner_text(), min_price)
                        if found_price: break

            elif platform == "alohacamp":
                selectors = [
                    "[data-testid='price-summary-total-price']", 
                    ".price-total", 
                    "div:has-text('Ostateczna cena')", 
                    "div:has-text('Razem')",
                    ".booking-card__price",
                    "span:has-text('zł')",
                    "div:has-text('zł')"
                ]
                for sel in selectors:
                    el = page.locator(sel).first
                    if await el.is_visible(timeout=2000):
                        found_price = extract_best_price(await el.inner_text(), min_price)
                        if found_price: break

            if found_price:
                return {"price": found_price, "status": "OK"}

            # Debug: if we are here, we didn't find a price. 
            # Check if there is a captcha marker in the text
            if "robot" in text.lower() or "captcha" in text.lower() or "verify you are human" in text.lower():
                return {"price": None, "status": "ERROR", "error": "CAPTCHA_DETECTED"}

            return {"price": None, "status": "SOLD_OUT"}

        except Exception as e:
            return {"price": None, "status": "ERROR", "error": str(e)}
        finally:
            await browser.close()

if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(1)
    platform, url, min_price = sys.argv[1:4]
    result = asyncio.run(scrape_audit(platform, url, min_price))
    print(json.dumps(result))
