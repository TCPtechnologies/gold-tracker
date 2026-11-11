# Gold Tracker (web)

Website version of the Gold Tracker Android app: SBI Gold Fund – Direct Growth (ISIN INF200K01RP8), its NAV and
P/L, the next likely NAV from the live SBI Gold ETF (NSE: SBIGOLD) price, and the US gold (XAU/USD) projection
after the 3:30 pm close. No notifications (those are in the Android app).

Live site: https://tcptechnologies.github.io/gold-tracker/

- Static HTML, CSS and JavaScript (ES modules), no build step. Hosted free on GitHub Pages.
- The page reads NAVs from mfapi.in and gold spot from gold-api.com directly (both allow browser requests).
- SBIGOLD prices, AMFI, NSE's daily report and stored history come from the Gold Tracker server, a Google Apps
  Script web app (`js/config.js`, source in the main project's `apps-script/`).
- Holding and settings are kept in this browser (localStorage). Defaults are in `js/config.js`.

Address options: `?at=2026-11-05T20:00` runs the calculations at that IST time (for checking), `?api=<url>`
uses another server (for example the local stand-in).

Run locally: `python -m http.server 8000` in this folder, then open http://localhost:8000.
