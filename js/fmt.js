import { ist, now, dayOfWeek, addDays } from './market.js';

export const MINUS = '\u2212';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Indian digit grouping: 4,99,975.00 */
function groupIndian(intStr) {
  if (intStr.length <= 3) return intStr;
  const last3 = intStr.slice(-3);
  const rest = intStr.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return rest + ',' + last3;
}

export function fmtInr(x, signed = false, decimals = true) {
  const a = Math.abs(x);
  const [i, f] = a.toFixed(decimals ? 2 : 0).split('.');
  const body = '₹' + groupIndian(i) + (f ? '.' + f : '');
  const zero = /^₹0(\.00)?$/.test(body);
  if (x < 0 && !zero) return MINUS + body;
  if (signed && x > 0 && !zero) return '+' + body;
  return body;
}

export function fmtNum(x, digits) {
  const s = Math.abs(x).toFixed(digits);
  return x < 0 && /[1-9]/.test(s) ? MINUS + s : s;
}

export function fmtSigned(x, digits) {
  const s = fmtNum(x, digits);
  return x > 0 && /[1-9]/.test(s) ? '+' + s : s;
}

export const fmtPct = (pct, digits = 2) => fmtSigned(pct, digits) + '%';
export const fmtNav = (x) => x.toFixed(4);
export const fmtPrice = (x) => x.toFixed(2);
export const fmtUsd = (x) => '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtDay(date) {
  const [, m, d] = date.split('-');
  return `${DAYS[dayOfWeek(date)]} ${+d} ${MONTHS[+m - 1]}`;
}
export const fmtDayLong = (date) => `${fmtDay(date)} ${date.slice(0, 4)}`;
/** "Wednesday's (11 Nov)" */
export function fmtWeekdayOf(date) { const [, m, d] = date.split('-'); return `${DAYS_FULL[dayOfWeek(date)]}'s (${+d} ${MONTHS[+m - 1]})`; }
export function fmtDayShort(date) { const [, m, d] = date.split('-'); return `${+d} ${MONTHS[+m - 1]}`; }

export function fmtClock(min, sec) {
  const h = Math.floor(min / 60), m = min % 60;
  let s = `${h % 12 || 12}:${String(m).padStart(2, '0')}`;
  if (sec !== undefined) s += ':' + String(sec).padStart(2, '0');
  return s + (h < 12 ? ' am' : ' pm');
}
export function fmtClockMs(ms, withSec = false) { const n = ist(ms); return fmtClock(n.min, withSec ? n.sec : undefined); }
export const fmtStamp = (ms) => (ms ? `${fmtDay(ist(ms).date)} ${fmtClockMs(ms, true)}` : '');

export function fmtWhen(ms) {
  const n = ist(ms), today = now().date;
  const day = n.date === today ? 'today' : n.date === addDays(today, -1) ? 'yesterday' : fmtDay(n.date);
  return `${day} ${fmtClock(n.min)}`;
}

export function fmtDayRel(date) {
  const today = now().date;
  if (date === today) return `today (${fmtDay(date)})`;
  if (date === addDays(today, 1)) return `tomorrow (${fmtDay(date)})`;
  if (date === addDays(today, -1)) return `yesterday (${fmtDay(date)})`;
  return fmtDay(date);
}

/** "2nd Nov 2026 (Yesterday)" */
export function fmtDateOrdinal(date) {
  const [y, m, d] = date.split('-').map(Number);
  const suf = d >= 11 && d <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[d % 10] || 'th');
  const today = now().date;
  const rel = date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : DAYS_FULL[dayOfWeek(date)];
  return `${d}${suf} ${MONTHS[m - 1]} ${y} (${rel})`;
}

/** CSS class for a gain (green), loss (red) or nothing. */
export const tone = (x) => (x == null || Math.abs(x) < 1e-9 ? '' : x > 0 ? 'up' : 'down');
