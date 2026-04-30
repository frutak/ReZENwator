import sys
import json
import asyncio
import re
import random
from playwright.async_api import async_playwright
from playwright_stealth import Stealth

async def scrape_ratings(url):
    portal = "unknown"
    if "booking.com" in url: portal = "booking"
    elif "airbnb" in url: portal = "airbnb"
    elif "google" in url: portal = "google"
    elif "slowhop.com" in url: portal = "slowhop"
    elif "alohacamp" in url: portal = "alohacamp"

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        
        ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        if portal == "airbnb":
            ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

        context = await browser.new_context(user_agent=ua)
        page = await context.new_page()
        await Stealth().apply_stealth_async(page)
        
        try:
            # Use domcontentloaded + manual sleep as networkidle can timeout on busy sites
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
            await asyncio.sleep(random.uniform(3, 5))

            # Bypass cookie consent if present (common on Google and others)
            for btn_text in ["Accept all", "Zgadzam się", "Zaakceptuj wszystko", "I agree", "Accept"]:
                try:
                    btn = page.get_by_role("button", name=btn_text, exact=False).first
                    if await btn.is_visible(timeout=2000):
                        await btn.click()
                        await asyncio.sleep(2)
                except: continue
            
            # Scroll down to trigger lazy loading of reviews/ratings
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight/3)")
            await asyncio.sleep(2)
            
            rating = None
            count = None

            if portal == "booking":
                selectors = ["[data-testid='review-score-component'] div:first-child", "div.a3332d346a", "span.b5cd09854e"]
                for sel in selectors:
                    el = page.locator(sel).first
                    if await el.count() > 0:
                        text = await el.inner_text()
                        match = re.search(r'(\d+[.,]\d+)', text)
                        if match:
                            rating = match.group(1).replace(",", ".")
                            break
                
                count_selectors = ["[data-testid='review-score-component'] div:last-child", "div.db29c4aa2a", "div.d8eab2cf7f"]
                for sel in count_selectors:
                    el = page.locator(sel).first
                    if await el.count() > 0:
                        text = await el.inner_text()
                        match = re.search(r'(\d+)', text.replace("\xa0", "").replace(" ", ""))
                        if match:
                            count = match.group(1)
                            break

            elif portal == "airbnb":
                selectors = ["span._17p6nbba", "[data-testid='average_rating']", "span._1y74zjx"]
                for sel in selectors:
                    el = page.locator(sel).first
                    if await el.count() > 0:
                        text = await el.inner_text()
                        match = re.search(r'(\d+[.,]\d+)', text)
                        if match:
                            rating = match.group(1).replace(",", ".")
                            break

                count_selectors = ["span._148f106", "[data-testid='pdp_reviews_link_top_of_page']", "button:has-text('reviews')"]
                for sel in count_selectors:
                    el = page.locator(sel).first
                    if await el.count() > 0:
                        text = await el.inner_text()
                        match = re.search(r'(\d+)', text.replace("\xa0", "").replace(" ", ""))
                        if match:
                            count = match.group(1)
                            break

            # Generic fallback or additional patterns
            if not rating or not count:
                body_text = await page.inner_text("body")
                
                if not rating:
                    r_patterns = [
                        r'(\d+[.,]\d+)\s*•\s*Liczba opinii:', # Slowhop overall: "4.5•Liczba opinii: 19"
                        r'(\d+[.,]\d+)\s*·\s*\d+\s+reviews', # Airbnb: "4.97 · 35 reviews"
                        r'(\d+[.,]\d+)\s*·\s*\d+\s+opinii', # Airbnb PL: "4.97 · 35 opinii"
                        r'Rated\s+(\d+[.,]\d+)', # Airbnb: "Rated 4.97"
                        r'(\d+[.,]\d+)\s*/\s*10',
                        r'(\d+[.,]\d+)\s*/\s*5',
                        r'(\d+[.,]\d+)\s*\(\d+\s+(ocen|ocena|opinii|reviews)',
                        r'(\d+[.,]\d+)\s+gwiazd',
                        r'(\d+[.,]\d+)\s+stars',
                        r'(\d+[.,]\d+)\s*\(\d+\)', # Google compact: "4,6(17)"
                        r'(\d+)\s*•\s*\d+\s+(sty|lut|mar|kwi|maj|cze|lip|sie|wrz|paź|lis|gru)' # Slowhop individual review (last resort)
                    ]
                    for pat in r_patterns:
                        r_match = re.search(pat, body_text, re.I)
                        if r_match:
                            rating = r_match.group(1).replace(",", ".")
                            break
                
                if not count:
                    c_patterns = [
                        r'(\d+)\s+reviews',
                        r'(\d+)\s+opinii',
                        r'(\d+)\s+ocen',
                        r'(\d+)\s+opinie',
                        r'Liczba opinii:\s+(\d+)',
                        r'opinii:\s*(\d+)',
                        r'\((\d+)\s+(ocen|ocena|opinii|reviews|opinie)',
                        r'·\s*(\d+)\s+reviews',
                        r'·\s*(\d+)\s+opinii',
                        r'\d+[.,]\d+\s*\((\d+)\)' # Matches count in 4.6(17) correctly
                    ]
                    for pat in c_patterns:
                        c_match = re.search(pat, body_text, re.I)
                        if c_match:
                            count = c_match.group(1)
                            break

            if rating and count:
                return {
                    "rating": float(rating),
                    "count": int(count),
                    "status": "OK"
                }
            else:
                return {"error": "Could not find rating or count", "status": "NOT_FOUND"}

        except Exception as e:
            return {"error": str(e), "status": "ERROR"}
        finally:
            await browser.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No URL provided"}))
        sys.exit(1)
    url = sys.argv[1]
    print(json.dumps(asyncio.run(scrape_ratings(url))))
