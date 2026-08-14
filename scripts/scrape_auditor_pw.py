"""Reads what each portal quotes for a stay, for the price auditor.

Two entry points:

    scrape_auditor_pw.py --batch <base64 json>   # what the worker calls
    scrape_auditor_pw.py <platform> <url> <min>  # one channel, for poking by hand

Batch mode exists because a browser launch is the expensive and failure-prone part
of this: one Chromium serves every channel of a probe instead of one per channel.
Each channel still gets its own context, so cookies and the user-agent stay isolated.

Statuses returned per channel:

    OK        a price was read
    SOLD_OUT  the page said the dates are unavailable
    NO_PRICE  the page loaded, said nothing about availability, and showed no price
              we could read — we do not know, and must not claim the stay is booked
    ERROR     navigation failed, timed out, or hit a bot wall
"""
import sys
import json
import base64
import asyncio
import re
import random
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout
from playwright_stealth import Stealth

DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

# Something on the page that means the price has rendered. Waiting for one of these
# replaces a flat 8-12s sleep: on a slow load that sleep expired before the booking
# panel existed and the probe reported a stay as unavailable when it simply had not
# looked yet, and on a fast load it burned ten seconds for nothing. Comma-joined, so
# Playwright resolves on whichever appears first.
PRICE_READY = {
    "booking": "#hprt-table, .prco-valign-middle-helper, [data-testid='price-and-pos-availability']",
    "airbnb": "[data-section-id='BOOK_IT_SIDEBAR'], div[data-testid='book-it-default'], span._1y74zjx",
    "slowhop": ".price-summary-row--main, .price-summary-row__value, .summary-price, .total-amount",
    "alohacamp": "[data-testid='price-summary-total-price'], .price-total, .booking-card__price",
}

PRICE_READY_TIMEOUT_MS = 25000

# Once the node exists the amount can still be a moment behind it.
SETTLE_SECONDS = 1.5

# Consulted only when no price could be read — a page that shows a price is selling,
# whatever else is written on it. That ordering is what lets short, common words like
# "niedostępne" be used at all.
SOLD_OUT_MARKERS = [
    "brak wolnych pokoi", "nie znaleźliśmy ofert", "sold out", "termin jest zajęty",
    "not available", "minimum stay", "pobyt minimalny",
    "wybrany termin jest zajęty", "zapytaj o inny termin", "brak miejsc",
    "wybierz daty", "wpisz daty", "zobacz dostępność",
    # How a refused stay actually reads once the minimum is enforced: Airbnb spells the
    # minimum out ("Minimalna długość pobytu to 2 dni"), AlohaCamp just says so. Without
    # these two the refusal was unreadable, and three page loads were spent per channel
    # per min-stay test failing to read it.
    "minimalna długość pobytu", "niedostępne",
]

BLOCKED_MARKERS = ["robot", "captcha", "verify you are human"]


def extract_best_price(text, min_p):
    """Largest plausible amount in `text`, or None."""
    if not text:
        return None
    # Match the amount whether the currency is a suffix ("3 132 zł" — Polish locale)
    # or a prefix ("zł 3,132" — English/US locale, which Airbnb now serves to some
    # user-agents). Capturing both directions in a single pass preserves the original
    # left-to-right order so "last valid value" semantics still hold.
    num = r'\d[\d\s\xa0.,]*\d|\d'
    matches = []
    for mm in re.finditer(rf'(?:zł|PLN)\s?({num})|({num})\s?(?:zł|PLN)', text, re.IGNORECASE):
        matches.append(mm.group(1) or mm.group(2))
    valid_values = []
    for m in matches:
        try:
            m_clean = m.replace('\xa0', '').replace(' ', '')
            # Handle decimals: if the string ends with a separator followed by 2 digits, remove them
            if len(m_clean) > 3 and m_clean[-3] in [',', '.']:
                val_str = m_clean[:-3].replace(',', '').replace('.', '')
            else:
                val_str = m_clean.replace(',', '').replace('.', '')

            if not val_str:
                continue
            val = int(val_str)
            if val in [2024, 2025, 2026, 2027]:
                continue
            if float(min_p) <= val <= 40000:
                valid_values.append(val)
        except Exception:
            pass

    # Return the LAST valid value found, as it's typically the final total or the new price after a discount
    return valid_values[-1] if valid_values else None


def guests_from_url(url):
    """The guest count the audit asked for, read back off the URL it built.

    Every portal carries it under a different key, and the auditor is the only
    caller, so the URL is the single source of truth — no extra argument to keep
    in sync with `PORTAL_URLS`.
    """
    for key in ("group_adults", "adults_count", "adults"):
        m = re.search(r'[?&]' + key + r'=(\d+)', url)
        if m:
            return int(m.group(1))
    return None


# Booking encodes each offer as `room_rateplan_maxOccupancy_meal_discount`.
def block_occupancy(row):
    """Max guests an offer row is priced for, or 0 when it cannot be determined."""
    parts = (row.get("id") or "").split("_")
    if len(parts) > 2 and parts[2].isdigit():
        occ = int(parts[2])
        if occ:
            return occ

    # Some rows carry `0` in the block id (an offer with no occupancy cap of its
    # own). Those still render the real ceiling in the "Liczba gości" column, so
    # fall back to it. The room description cell never uses this phrasing, so the
    # match cannot pick up the searched-for occupancy by mistake.
    nums = re.findall(r'(?:maksymalna liczba os[oó]b|max(?:imum)? (?:people|occupancy|guests))\s*:?\s*(\d+)',
                      row.get("text") or "", re.IGNORECASE)
    return max(int(n) for n in nums) if nums else 0


async def booking_price_for_guests(page, min_price, guests):
    """Cheapest Booking offer a party of `guests` can actually book.

    Booking lists every occupancy tier as a separate row and does not filter them
    to the searched party size, so reading "some price off the page" picks an
    arbitrary tier — for Sadoles that meant recording the 9-guest rate against an
    11-guest benchmark. Match the tier to what was asked for instead: the smallest
    tier that still fits the party, and within it the lowest rate, which is what a
    guest sees as the price of the stay.
    """
    rows = await page.evaluate("""() => {
      const out = [];
      document.querySelectorAll('#hprt-table tr[data-block-id]').forEach(tr => {
        const priceEl = tr.querySelector('.prco-valign-middle-helper, [data-testid="price-and-discounted-price"]');
        if (!priceEl) return;
        out.push({
          id: tr.getAttribute('data-block-id') || '',
          price: priceEl.innerText || '',
          text: tr.innerText || ''
        });
      });
      return out;
    }""")

    priced = []
    for row in rows:
        value = extract_best_price(row.get("price"), min_price)
        if value is None:
            continue
        priced.append((block_occupancy(row), value))

    if not priced:
        return None

    fits = [p for p in priced if guests and p[0] >= guests]
    if not fits:
        # Nothing advertised for a party this size — compare against the largest
        # tier on offer rather than silently falling back to the cheapest one.
        largest = max(occ for occ, _ in priced)
        fits = [p for p in priced if p[0] == largest]

    return min(value for _, value in fits)


async def first_visible_price(page, selectors, min_price, pick_last=False):
    """Price from the first of `selectors` that is visible and parses."""
    for sel in selectors:
        el = page.locator(sel).last if pick_last else page.locator(sel).first
        try:
            if await el.is_visible(timeout=2000):
                found = extract_best_price(await el.inner_text(), min_price)
                if found:
                    return found
        except Exception:
            continue
    return None


async def wait_for_price(page, platform):
    """Give the price a chance to render. Not finding it is not an error here —
    an unavailable stay never renders one, and the marker check decides that."""
    selector = PRICE_READY.get(platform)
    if not selector:
        return
    try:
        await page.wait_for_selector(selector, timeout=PRICE_READY_TIMEOUT_MS, state="attached")
        await asyncio.sleep(SETTLE_SECONDS)
    except PlaywrightTimeout:
        pass


async def scrape_channel(browser, platform, url, min_price):
    """One channel on an already-running browser. Never raises."""
    context = None
    try:
        ua = MOBILE_UA if platform == "airbnb" else DESKTOP_UA
        context = await browser.new_context(user_agent=ua, locale="pl-PL")
        page = await context.new_page()
        await Stealth().apply_stealth_async(page)

        await page.goto(url, wait_until="domcontentloaded", timeout=60000)
        await wait_for_price(page, platform)

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

        # 2. A bot wall is our problem, not an answer about availability. Checked
        #    before the markers, since a challenge page can contain anything.
        if any(m in text.lower() for m in BLOCKED_MARKERS):
            return {"price": None, "status": "ERROR", "error": "CAPTCHA_DETECTED"}

        # 3. Read the price. Done before the availability markers, not after: a page
        #    quoting a price is selling the stay whoever else says otherwise, and a
        #    marker that outranks a real price is a marker that can erase one.
        if platform == "booking":
            found_price = await booking_price_for_guests(page, min_price, guests_from_url(url))
            if not found_price:
                # The offer table did not render (layout change, partial load).
                # Sweep the page as before rather than reporting a false NO_PRICE.
                found_price = await first_visible_price(
                    page,
                    [".prco-valign-middle-helper", "[data-testid='price-and-pos-availability']", ".bui-price-display__value"],
                    min_price,
                )
        elif platform == "airbnb":
            found_price = await first_visible_price(page, [
                "span._1y74zjx",
                "div[data-testid='book-it-default']",
                "[data-section-id='BOOK_IT_SIDEBAR']",
                "span:has-text('zł total')",
                "div:has-text('Łącznie') + div",
            ], min_price)
        elif platform == "slowhop":
            found_price = await first_visible_price(page, [
                ".price-summary-row--main",
                ".price-summary-row__value",
                ".summary-price",
                ".total-amount",
                "div:has-text('Łącznie') + div",
                "div:has-text('Łącznie') ~ div",
            ], min_price, pick_last=True)
        elif platform == "alohacamp":
            found_price = await first_visible_price(page, [
                "[data-testid='price-summary-total-price']",
                ".price-total",
                "div:has-text('Ostateczna cena')",
                "div:has-text('Razem')",
                ".booking-card__price",
                "span:has-text('zł')",
                "div:has-text('zł')",
            ], min_price)
        else:
            return {"price": None, "status": "ERROR", "error": f"unknown platform {platform}"}

        if found_price:
            return {"price": found_price, "status": "OK"}

        # 4. No price. Now the markers decide whether the portal said the stay is
        #    unavailable, or whether we simply could not read the page.
        if any(m in text.lower() for m in SOLD_OUT_MARKERS):
            return {"price": None, "status": "SOLD_OUT"}

        # Neither a price nor a word about availability. That is ignorance, not a
        # sold-out stay, and recording it as one is what made a broken parser look
        # like a fully booked calendar.
        return {"price": None, "status": "NO_PRICE", "error": "no availability marker and no readable price"}

    except PlaywrightTimeout as e:
        return {"price": None, "status": "ERROR", "error": f"timeout: {str(e)[:200]}"}
    except Exception as e:
        return {"price": None, "status": "ERROR", "error": str(e)[:200]}
    finally:
        if context:
            try:
                await context.close()
            except Exception:
                pass


async def run_batch(job):
    """All of a probe's channels on one browser."""
    min_price = job["minPrice"]
    targets = job["targets"]
    results = {}

    pw = None
    browser = None
    try:
        pw = await async_playwright().start()
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        for target in targets:
            channel = target["channel"]
            results[channel] = await scrape_channel(browser, channel, target["url"], min_price)
            # A pause between channels on the same browser, as before.
            if target is not targets[-1]:
                await asyncio.sleep(random.uniform(1.5, 3.0))
    except Exception as e:
        # Browser-level failure: whatever has not run yet could not have run.
        for target in targets:
            results.setdefault(target["channel"], {
                "price": None, "status": "ERROR", "error": f"browser unavailable: {str(e)[:200]}"
            })
    finally:
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
        if pw:
            try:
                await pw.stop()
            except Exception:
                pass

    return results


def main():
    args = sys.argv[1:]

    if args and args[0] == "--batch":
        job = json.loads(base64.b64decode(args[1]).decode("utf-8"))
        print(json.dumps(asyncio.run(run_batch(job))))
        return

    if len(args) < 3:
        sys.stderr.write(__doc__)
        sys.exit(1)

    platform, url, min_price = args[0], args[1], args[2]
    job = {"minPrice": min_price, "targets": [{"channel": platform, "url": url}]}
    print(json.dumps(asyncio.run(run_batch(job))[platform]))


if __name__ == "__main__":
    main()
