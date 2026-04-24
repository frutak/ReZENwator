import asyncio
import sqlite3
import re
import smtplib
import random
import shutil
import os
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from playwright.async_api import async_playwright
from playwright_stealth import Stealth

# --- 1. KONFIGURACJA ---
CONFIG = {
    "properties": {
        "sado": {
            "min": 1000, "max": 15000, "min_n": 800, "occ": "11", "aloha_occ": "11",
            "sh_id": "2256-sadoles-66", "air_id": "39273784", "book_id": "sadoles-66.pl",
            "aloha_id": "sadoles-66-4436"
        },
        "hacjenda": {
            "min": 600, "max": 10000, "min_n": 500, "occ": "4",
            "sh_id": "4575-hacjenda-kiekrz", "air_id": "1327633659929514853", "book_id": "hacienda-kiekrz"
        }
    },
    "commissions": {"booking": 1.145, "airbnb": 1.173, "slowhop": 1.15, "alohacamp": 1.15},
    "holidays": ["2026-04-05", "2026-04-06", "2026-05-01", "2026-05-02", "2026-05-03", "2026-06-04", "2026-12-24", "2026-12-25", "2026-12-26", "2026-12-31"],
    "email": {"sender": "frutak@gmail.com", "pass": "pdwz prir otsr vsig", "receiver": "szymonfurtak@hotmail.com"}
}

# --- 2. LOSOWANIE DAT (V88) ---
def generate_smart_dates():
    today = datetime.now()
    dates = []
    
    # WEEKENDY (4 najbliższe)
    for i in range(4):
        friday = today + timedelta(days=((4 - today.weekday()) % 7) + i * 7)
        if friday <= today: friday += timedelta(days=7)
        
        duration = random.choice([2, 3]) # 2 lub 3 noce
        if duration == 2:
            dates.append((friday.strftime("%Y-%m-%d"), (friday + timedelta(days=2)).strftime("%Y-%m-%d")))
        else:
            start_offset = random.choice([-1, 0]) # Czw-Nd lub Pt-Pn
            start_dt = friday + timedelta(days=start_offset)
            dates.append((start_dt.strftime("%Y-%m-%d"), (start_dt + timedelta(days=3)).strftime("%Y-%m-%d")))

    # ŚWIĘTA
    for h in CONFIG["holidays"]:
        h_dt = datetime.strptime(h, "%Y-%m-%d")
        if h_dt > today:
            duration = random.randint(3, 4)
            dates.append((h, (h_dt + timedelta(days=duration)).strftime("%Y-%m-%d")))

    # WILD CARDS (5 losowych terminów)
    for _ in range(5):
        random_start = today + timedelta(days=random.randint(7, 180))
        duration = random.randint(2, 4)
        dates.append((random_start.strftime("%Y-%m-%d"), (random_start + timedelta(days=duration)).strftime("%Y-%m-%d")))

    return sorted(list(set(dates)))

# --- 3. NARZĘDZIA I DB ---
def clean_price_safe(raw_text, min_exp):
    if not raw_text: return None
    t = raw_text.replace('\xa0', ' ').replace(',', '').replace('.00', '')
    nums = re.findall(r'\d[\d\s]{2,5}', t)
    valid = [int(re.sub(r'[^\d]', '', n)) for n in nums if min_exp <= int(re.sub(r'[^\d]', '', n)) <= 15000 and int(re.sub(r'[^\d]', '', n)) not in [2024, 2025, 2026, 2027]]
    return valid[-1] if valid else None

class PriceDB:
    def __init__(self, path="monitoring_v88.db"):
        self.path = path
        with sqlite3.connect(self.path) as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, date_scraped DATETIME DEFAULT CURRENT_TIMESTAMP, property TEXT, check_in TEXT, check_out TEXT, p_book REAL, s_book TEXT, p_air REAL, s_air TEXT, p_slow REAL, s_slow TEXT, p_aloha REAL, s_aloha TEXT)")

    def save(self, prop, start, end, res):
        def parse(ch):
            v = res.get(ch)
            return (v, "WOLNE") if isinstance(v, (int, float)) else (None, str(v) if v else "SOLD_OUT")
        b, sb = parse("booking"); a, sa = parse("airbnb"); s, ss = parse("slowhop"); al, sal = parse("alohacamp")
        with sqlite3.connect(self.path) as conn:
            conn.execute("INSERT INTO logs (property, check_in, check_out, p_book, s_book, p_air, s_air, p_slow, s_slow, p_aloha, s_aloha) VALUES (?,?,?,?,?,?,?,?,?,?,?)", (prop, start, end, b, sb, a, sa, s, ss, al, sal))

# --- 4. ENGINE SCRAPERA ---
async def scrape_v88(page, platform, p_key, start, end):
    p = CONFIG["properties"][p_key]
    min_exp = p.get("min_n", 500) * (datetime.strptime(end, "%Y-%m-%d") - datetime.strptime(start, "%Y-%m-%d")).days

    # Wybór URL (skrócony dla czytelności)
    if platform == "alohacamp":
        s_dt = (datetime.strptime(start, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
        e_dt = (datetime.strptime(end, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
        url = f"https://alohacamp.com/pl/property/{p['aloha_id']}?adults_count={p['aloha_occ']}&start={s_dt}T23%3A00%3A00.000Z&end={e_dt}T23%3A00%3A00.000Z"
    else:
        url_map = {"booking": f"https://www.booking.com/hotel/pl/{p['book_id']}.html?checkin={start}&checkout={end}&group_adults={p['occ']}", "airbnb": f"https://www.airbnb.com/rooms/{p['air_id']}?check_in={start}&check_out={end}&adults={p['occ']}", "slowhop": f"https://slowhop.com/pl/miejsca/{p['sh_id']}.html?adults={p['occ']}&start_date={start}&end_date={end}"}
        url = url_map[platform]

    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=50000)
        await asyncio.sleep(8) # Bezpieczny czas na dynamiczny kontent
        txt = await page.inner_text("body")
        
        if platform == "booking":
            if any(x in txt for x in ["Brak wolnych", "Sold out", "zajęty"]): return "SOLD_OUT"
            for sel in ["[data-testid='price-and-pos-availability']", ".prco-valign-middle-helper", ".bui-price-display__value"]:
                el = page.locator(sel).first
                if await el.is_visible(timeout=3000):
                    return clean_price_safe(await el.inner_text(), min_exp)
            return "SOLD_OUT"
        
        elif platform == "airbnb":
            sidebar = page.locator("[data-section-id='BOOK_IT_SIDEBAR'], div[data-testid='book-it-default']").first
            if await sidebar.count() > 0:
                it = await sidebar.inner_text()
                if any(x in it.lower() for x in ["minimum stay", "pobyt minimalny"]): return "MIN_STAY_VIOLATION"
                return clean_price_safe(it, min_exp) or "SOLD_OUT"
            return "SOLD_OUT"
        
        elif platform == "slowhop":
            if any(x in txt.lower() for x in ["termin jest zajęty", "brak wolnych"]): return "SOLD_OUT"
            return clean_price_safe(txt, min_exp) or "SOLD_OUT"

        elif platform == "alohacamp":
            return clean_price_safe(txt, min_exp) or "SOLD_OUT"

    except Exception: return "ERROR"

# --- 5. AUDYT Z IZOLACJĄ BŁĘDÓW ---
async def run_property_audit(pw, p_key, dates, db, alerts):
    user_data_dir = f"/tmp/pw_v88_{p_key}_{random.randint(100, 999)}"
    print(f"\nAUDYT V88: {p_key.upper()} (Nowy Context)")
    
    try:
        context = await pw.firefox.launch_persistent_context(user_data_dir, headless=True)
        page = context.pages[0]
        await Stealth().apply_stealth_async(page)
        
        for start, end in dates:
            channels = ["booking", "airbnb", "slowhop"]
            if "aloha_id" in CONFIG["properties"][p_key]: channels.append("alohacamp")
            
            res_map, nets = {}, {}
            for chan in channels:
                res = await scrape_v88(page, chan, p_key, start, end)
                
                # RECOVERY: Jeśli strona sypie błędami połączenia
                if res == "ERROR":
                    try:
                        await page.close()
                        page = await context.new_page()
                        await Stealth().apply_stealth_async(page)
                        res = await scrape_v88(page, chan, p_key, start, end)
                    except: res = "ERROR"
                
                res_map[chan] = res
                if isinstance(res, int): nets[chan] = res / CONFIG["commissions"][chan]

            db.save(p_key, start, end, res_map)
            print(f"  {start} - {end} ({ (datetime.strptime(end, '%Y-%m-%d') - datetime.strptime(start, '%Y-%m-%d')).days } n.) -> {res_map}")
            
            # Alerty netto
            active = {k: v for k, v in nets.items() if v is not None}
            if len(active) > 1:
                diff = (max(active.values()) - min(active.values())) / min(active.values())
                if diff > 0.12: alerts.append(f"[{p_key.upper()}] {start} {end}: Różnica {round(diff*100)}% {res_map}")

        # BEZPIECZNE ZAMYKANIE (Fix dla TypeError: childFrames)
        try:
            await context.close()
        except:
            print("  [DEBUG] Context już zamknięty przez błąd silnika.")
            
    finally:
        if os.path.exists(user_data_dir):
            shutil.rmtree(user_data_dir, ignore_errors=True)

async def main():
    db = PriceDB()
    alerts = []
    unique_dates = generate_smart_dates()
    
    async with async_playwright() as pw:
        for p_key in CONFIG["properties"]:
            await run_property_audit(pw, p_key, unique_dates, db, alerts)

    if alerts:
        msg = MIMEMultipart(); msg['Subject'] = f"ALARM V88: {len(alerts)} błędów"; msg['From'] = CONFIG["email"]["sender"]; msg['To'] = CONFIG["email"]["receiver"]
        msg.attach(MIMEText("\n".join(alerts), 'plain'))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
            s.login(CONFIG["email"]["sender"], CONFIG["email"]["pass"])
            s.send_message(msg)

if __name__ == "__main__":
    asyncio.run(main())
