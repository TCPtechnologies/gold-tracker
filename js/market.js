// NSE calendar and India-time helpers. India has no daylight saving: IST = UTC + 5:30.
// Dates are 'YYYY-MM-DD' strings, times of day minutes after midnight IST, instants epoch ms.

export const OPEN = 9 * 60 + 15;            // 9:15 am
export const CLOSE = 15 * 60 + 30;          // 3:30 pm
export const VWAP_FROM = 15 * 60;           // NSE close = volume-weighted average of 3:00-3:30 pm trades
export const NAV_EARLIEST = 18 * 60;        // a day's NAV can appear from 6 pm
export const NAV_DEADLINE = 10 * 60;        // SEBI: fund-of-fund NAVs by 10 am next business day
const IST_MS = 19800000;

// NSE equity trading holidays on weekdays in 2026 (NSE circular).
const BUILT_IN = [
  '2026-01-15', '2026-01-26', '2026-03-03', '2026-03-26', '2026-03-31', '2026-04-03',
  '2026-04-14', '2026-05-01', '2026-05-28', '2026-06-26', '2026-09-14', '2026-10-02',
  '2026-10-20', '2026-11-10', '2026-11-24', '2026-12-25',
];
let holidays = new Set(BUILT_IN);

export function setHolidays(...lists) {
  holidays = new Set(BUILT_IN);
  for (const l of lists) for (const d of l || []) if (/^\d{4}-\d{2}-\d{2}$/.test(d)) holidays.add(d);
}

export function holidayYears() {
  return new Set([...holidays].map((d) => +d.slice(0, 4)));
}

// Test clock: ?at=2026-11-05T20:00 in the page address (IST).
let offset = 0;
export function setClock(atIst) {
  const t = Date.parse(atIst + '+05:30');
  if (!isNaN(t)) offset = t - Date.now();
}
export const clockShifted = () => offset !== 0;
export const nowMs = () => Date.now() + offset;

/** {ms, date, min, sec} in IST. */
export function ist(ms) {
  const d = new Date(ms + IST_MS);
  return { ms, date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), sec: d.getUTCSeconds() };
}
export const now = () => ist(nowMs());

export function istMs(date, min, sec = 0) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) + min * 60000 + sec * 1000 - IST_MS;
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function dayOfWeek(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const isTradingDay = (date) => { const w = dayOfWeek(date); return w !== 0 && w !== 6 && !holidays.has(date); };
export function nextTradingDay(date) { let d = addDays(date, 1); while (!isTradingDay(d)) d = addDays(d, 1); return d; }
export function prevTradingDay(date) { let d = addDays(date, -1); while (!isTradingDay(d)) d = addDays(d, -1); return d; }
export const onOrAfter = (date) => (isTradingDay(date) ? date : nextTradingDay(date));

export const inSession = (n) => isTradingDay(n.date) && n.min >= OPEN && n.min < CLOSE;

/** Newest NAV date that can be out by now. */
export const expectedNavDate = (n) => (isTradingDay(n.date) && n.min >= NAV_EARLIEST ? n.date : prevTradingDay(n.date));

/** Latest trading day whose 3:30 pm close has passed. */
export const lastClosedSession = (n) => (isTradingDay(n.date) && n.min >= CLOSE ? n.date : prevTradingDay(n.date));

/** Time by which the NAV of [navDate] must be on AMFI. */
export const navDeadline = (navDate) => istMs(nextTradingDay(navDate), NAV_DEADLINE);

/**
 * Which NAV an order placed now gets on Coin (support.zerodha.com, non-liquid schemes): UPI and
 * direct-settlement netbanking before 2:00 pm get that day's NAV, other netbanking the next day's, redemptions
 * before 3:00 pm that day's.
 */
export function orderNavs(n, buyCutoff, redeemCutoff, fmtClock) {
  const tDay = (cut) => (isTradingDay(n.date) && n.min < cut ? n.date : nextTradingDay(n.date));
  return [
    { title: 'Buy · UPI or direct-settlement netbanking', rule: 'cut-off ' + fmtClock(buyCutoff), navDate: tDay(buyCutoff) },
    { title: 'Buy · other netbanking banks', rule: "always next day's NAV", navDate: nextTradingDay(onOrAfter(n.date)) },
    { title: 'Redeem', rule: 'cut-off ' + fmtClock(redeemCutoff), navDate: tDay(redeemCutoff) },
  ];
}
