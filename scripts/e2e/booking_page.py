"""Browser checks for the booking page (Playwright, Python).
Usage: python booking_page.py <page-url>     e.g. http://localhost:8787/demos/paperclip-booking-rehearsal/staging/
Exit 1 if any check fails. Each check is a sequence an external review reproduced against the earlier page."""
import sys, json, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1]
results = {}

def fresh(p):
    ctx = BROWSER.new_context(viewport={'width': 1100, 'height': 1400})
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until='networkidle'); pg.wait_for_timeout(800)
    pg.click('#reset'); pg.wait_for_timeout(800)
    return ctx, pg, errs

with sync_playwright() as p:
    BROWSER = p.chromium.launch()
    # 1. The reply to a committed booking is lost: the page must recover, show the booking once, stay usable.
    ctx, pg, errs = fresh(p)
    lost = {'n': 0}
    def drop_first(route):
        if route.request.method == 'POST' and lost['n'] == 0:
            lost['n'] += 1
            route.fetch()            # the server commits the booking...
            route.abort('failed')    # ...but the browser never sees the reply
        else:
            route.continue_()
    pg.route('**/api/bookings', drop_first)
    pg.locator('.slot:not([disabled])').first.click()
    pg.click('#book')
    try:
        pg.wait_for_function("document.getElementById('msg').textContent.startsWith('Booked')", timeout=10000)
    except Exception:
        pass
    pg.wait_for_timeout(800)
    msg = pg.inner_text('#msg')
    rows = pg.locator('.mine li:not(.cancelled)').count()
    pg.locator('.slot:not([disabled])').first.click()
    enabled = pg.is_enabled('#book')
    results['lost_reply_recovers'] = {'ok': msg.startswith('Booked') and rows == 1 and enabled and not errs,
                                      'message': msg, 'confirmed_rows': rows, 'book_button_enabled_after': enabled, 'errors': errs}
    ctx.close()

    # 2. A slow reply for an earlier day must not be mixed into the grid of the day chosen after it.
    ctx, pg, errs = fresh(p)
    dates = pg.eval_on_selector_all('.date:not([disabled])', 'b => b.map(x => x.dataset.d)')
    withslots = [d for d in dates if pg.evaluate(f"""async () => (await (await fetch('api/slots?sandbox=x-check-000&date={d}&durationMin=45')).json()).slots.length""") > 0]
    first, second = withslots[1], withslots[2]
    # Hold the reply for the first day for 1.5 s, inside the page, so the second day's reply arrives first.
    pg.evaluate(f"""() => {{ const f = window.fetch; window.fetch = (u, o) => f(u, o).then(r =>
        String(u).includes('date={first}') ? new Promise(res => setTimeout(() => res(r), 1500)) : r); }}""")
    pg.click(f'.date[data-d="{first}"]')
    pg.click(f'.date[data-d="{second}"]')
    pg.wait_for_timeout(3000)
    shown = pg.eval_on_selector_all('.slot', 'b => b.map(x => x.dataset.start)')
    want = pg.evaluate(f"""async () => (await (await fetch('api/slots?sandbox=x-check-000&date={second}&durationMin=45')).json()).slots.map(s => s.start)""")
    results['stale_slots_dropped'] = {'ok': sorted(shown) == sorted(want) and len(shown) > 0, 'selected': second, 'shown': len(shown), 'expected': len(want)}
    ctx.close()

    BROWSER.close()
print(json.dumps(results, indent=1))
sys.exit(0 if all(r['ok'] for r in results.values()) else 1)
