// Fetching and caching. mfapi.in and gold-api.com allow browser requests, so the page reads them directly;
// everything else (SBIGOLD price, AMFI, NSE, stored history) comes from the Apps Script server.
import { API_URL, DEFAULTS, ISIN, SCHEME_CODE } from './config.js';
import { ist, nowMs } from './market.js';

const params = new URLSearchParams(location.search);
export const api = params.get('api') || API_URL;

export const state = {
  navs: [],            // [{date, nav}] newest first, from mfapi.in (+ the server's AMFI reading)
  server: null,        // ?a=data payload
  quote: null,         // latest SBIGOLD trade
  spot: null,          // gold spot {ts, price}
  candleCache: {},     // date -> [{min,o,h,l,c,v}]
  fetched: {},         // source -> last success (ms)
  errors: {},          // source -> message
  loading: true,
};

async function getJson(url, timeoutMs = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'timed out' : e.message || String(e));
  } finally {
    clearTimeout(t);
  }
}

async function guard(source, fn) {
  try {
    const r = await fn();
    delete state.errors[source];
    state.fetched[source] = Date.now();
    return r;
  } catch (e) {
    state.errors[source] = e.message || String(e);
    return null;
  }
}

// ---------- settings ----------

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('gt_settings') || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s) { localStorage.setItem('gt_settings', JSON.stringify(s)); }

// ---------- NAV (mfapi.in) ----------

function parseMfapi(j) {
  if (!j || !j.meta || j.meta.isin_growth !== ISIN) throw new Error(`scheme ${SCHEME_CODE} is not ${ISIN}`);
  return (j.data || []).map((o) => {
    const [d, m, y] = String(o.date).split('-');
    return { date: `${y}-${m}-${d}`, nav: +o.nav };
  }).filter((x) => x.nav > 0 && /^\d{4}-\d{2}-\d{2}$/.test(x.date));
}

function mergeNavs(list) {
  const map = new Map(state.navs.map((x) => [x.date, x.nav]));
  for (const x of list) map.set(x.date, x.nav);
  state.navs = [...map].map(([date, nav]) => ({ date, nav })).sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Full history: from this browser's copy if fresh (6 h), else from mfapi.in (~130 KB). */
export async function loadNavHistory(force = false) {
  try {
    const c = JSON.parse(localStorage.getItem('gt_navs') || 'null');
    if (c && c.data) {
      mergeNavs(c.data);
      if (!force && Date.now() - c.fetched < 6 * 3600e3) { state.fetched['mfapi.in'] = c.fetched; return; }
    }
  } catch { /* ignore a broken cache */ }
  await guard('mfapi.in', async () => {
    const list = parseMfapi(await getJson(`https://api.mfapi.in/mf/${SCHEME_CODE}`, 30000));
    mergeNavs(list);
    const keep = state.navs.slice(0, 800);
    localStorage.setItem('gt_navs', JSON.stringify({ fetched: Date.now(), data: keep }));
  });
}

export async function pollNavLatest() {
  await guard('mfapi.in', async () => {
    const list = parseMfapi(await getJson(`https://api.mfapi.in/mf/${SCHEME_CODE}/latest`));
    const before = state.navs[0]?.date;
    mergeNavs(list);
    if (state.navs[0]?.date !== before) {
      localStorage.setItem('gt_navs', JSON.stringify({ fetched: Date.now(), data: state.navs.slice(0, 800) }));
    }
  });
}

// ---------- gold spot (gold-api.com) ----------

export async function pollSpot() {
  await guard('gold-api.com', async () => {
    const j = await getJson('https://api.gold-api.com/price/XAU', 15000);
    if (j.symbol !== 'XAU' || !(j.price > 0)) throw new Error('unexpected reply');
    const ts = Date.parse(j.updatedAt);
    state.spot = { ts: isNaN(ts) ? Date.now() : ts, price: Math.round(j.price * 100) / 100 };
  });
}

// ---------- Apps Script server ----------

export async function loadServer() {
  if (!api || api === 'APPS_SCRIPT_URL') { state.errors.server = 'server address not set'; return; }
  await guard('server', async () => {
    const p = await getJson(`${api}?a=data`, 45000);
    if (p.error) throw new Error(p.error);
    state.server = p;
    if (p.quote && (!state.quote || p.quote.time >= state.quote.time)) state.quote = p.quote;
    for (const [d, list] of Object.entries(p.candles || {})) state.candleCache[d] = list.map(toCandle);
    // AMFI as seen by the server, in case it is ahead of mfapi.in.
    const extra = Object.values(p.navLatest || {}).filter((x) => x && x.date && x.nav > 0);
    if (extra.length) mergeNavs(extra.filter((x) => !state.navs.some((y) => y.date === x.date)));
  });
}

export async function pollLive() {
  if (!api || api === 'APPS_SCRIPT_URL') return null;
  return guard('server', async () => {
    const j = await getJson(`${api}?a=live`, 30000);
    if (j.error) throw new Error(j.error);
    if (j.quote) state.quote = j.quote;
    state.fetched.live = Date.now();
    return j;
  });
}

export async function loadCandles(date) {
  if (state.candleCache[date] && date !== ist(nowMs()).date) return;
  await guard('server', async () => {
    const j = await getJson(`${api}?a=candles&date=${date}`, 45000);
    if (j.error) throw new Error(j.error);
    state.candleCache[date] = (j.candles || []).map(toCandle);
  });
}

const toCandle = (a) => ({ min: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] });

// ---------- views of the server payload ----------

export function etfDays() {
  return (state.server?.etfDays || []).map(([date, o, h, l, c, pc, src]) => ({ date, o, h, l, c, pc, src })).filter((d) => d.c > 0);
}

/** Gold readings near 9:15 am / 3:30 pm, one entry per stored reading. */
export function anchors() {
  const out = [];
  for (const [, ots, o, osrc, cts, c, csrc] of state.server?.gold || []) {
    if (ots && o) out.push({ ts: ots, price: o, approx: osrc !== 'gold-api' });
    if (cts && c) out.push({ ts: cts, price: c, approx: csrc !== 'gold-api' });
  }
  return out;
}

export function navSeen() {
  return (state.server?.navSeen || []).map(([date, src, nav, seenAt, prevCheck]) => ({ date, src, nav, seenAt, prevCheck }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.seenAt - b.seenAt));
}
