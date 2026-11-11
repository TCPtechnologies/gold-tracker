// The numbers on screen: P/L, NAV estimates from SBIGOLD, the US-gold projection and the gold comparison.
// Same rules as the Android app (Calc.kt).
import {
  CLOSE, OPEN, VWAP_FROM, ist, istMs, isTradingDay, nextTradingDay, prevTradingDay, lastClosedSession,
  inSession, navDeadline, orderNavs,
} from './market.js';
import { fmtClock } from './fmt.js';

export const BASIS = {
  LIVE: 'latest ETF price',
  VWAP_SO_FAR: 'ETF average price since 3:00 pm (how NSE sets the close)',
  APPROX_CLOSE: 'ETF closing price worked out from the 3:00–3:30 pm trades',
  CLOSE: 'ETF closing price',
  OFFICIAL: 'official NSE closing price',
  US_GOLD: 'ETF price implied by US gold (XAU/USD) since the last 3:30 pm close',
};

/** NSE close of an ETF: volume-weighted average price of 3:00-3:30 pm trades, from 5-minute candles. */
export function closingVwap(candles) {
  let pv = 0, vol = 0;
  for (const k of candles) {
    if (k.min < VWAP_FROM || k.min >= CLOSE || !(k.v > 0)) continue;
    pv += ((k.h + k.l + k.c) / 3) * k.v;
    vol += k.v;
  }
  return vol > 0 ? pv / vol : null;
}

/** The anchor reading closest to [targetMs], at most 15 minutes away; spot readings win over futures. */
export function nearestSpot(spots, targetMs, maxMin = 15) {
  const near = spots.filter((s) => Math.abs(s.ts - targetMs) <= maxMin * 60000);
  const pool = near.some((s) => !s.approx) ? near.filter((s) => !s.approx) : near;
  let best = null;
  for (const s of pool) if (!best || Math.abs(s.ts - targetMs) < Math.abs(best.ts - targetMs)) best = s;
  return best;
}

function goldDays(etfDays, spots, refDay, refClose) {
  if (!spots.length) return [];
  const byDate = new Map(etfDays.map((d) => [d.date, d]));
  const close = (d) => byDate.get(d)?.c ?? (d === refDay ? refClose : null);
  const xau = (d) => nearestSpot(spots, istMs(d, CLOSE));
  const first = ist(Math.min(...spots.map((s) => s.ts))).date;
  const out = [];
  for (let d = refDay; d >= first; d = prevTradingDay(d)) {
    const p = prevTradingDay(d);
    const c = close(d), pc = close(p), x = xau(d), px = xau(p);
    if (c == null || pc == null || !x || !px || x.approx !== px.approx) continue; // never mix spot with futures
    const o = nearestSpot(spots, istMs(d, OPEN));
    out.push({
      date: d, prev: p, etfClose: c, etfPrevClose: pc, xau: x.price, xauPrev: px.price,
      etfOpen: byDate.get(d)?.o ?? null, xauOpen: o && o.approx === px.approx ? o.price : null, approx: x.approx,
      etfPct: (c / pc - 1) * 100, xauPct: (x.price / px.price - 1) * 100,
    });
  }
  return out;
}

export const predictedOpen = (g, m) => (g.xauOpen == null ? null : g.etfPrevClose * (1 + m * (g.xauOpen / g.xauPrev - 1)));

function goldFit(days, m) {
  if (!days.length) return null;
  const x = days.map((d) => d.xauPct), y = days.map((d) => d.etfPct);
  const sxx0 = x.reduce((a, v) => a + v * v, 0);
  const slope = sxx0 > 1e-12 ? x.reduce((a, v, i) => a + v * y[i], 0) / sxx0 : null;
  let corr = null;
  if (days.length >= 3) {
    const mx = x.reduce((a, v) => a + v, 0) / x.length, my = y.reduce((a, v) => a + v, 0) / y.length;
    const sxx = x.reduce((a, v) => a + (v - mx) ** 2, 0), syy = y.reduce((a, v) => a + (v - my) ** 2, 0);
    const sxy = x.reduce((a, v, i) => a + (v - mx) * (y[i] - my), 0);
    if (sxx > 1e-12 && syy > 1e-12) corr = sxy / Math.sqrt(sxx * syy);
  }
  const err = (k) => x.reduce((a, v, i) => a + Math.abs(y[i] - k * v), 0) / x.length;
  const opens = days.map((d) => {
    const p = predictedOpen(d, m);
    return p != null && d.etfOpen != null ? Math.abs(d.etfOpen / d.etfPrevClose - p / d.etfPrevClose) * 100 : null;
  }).filter((v) => v != null);
  return {
    n: days.length, corr, slope, err1: err(1), errSlope: slope != null ? err(slope) : null,
    errMultiplier: Math.abs(m - 1) > 1e-9 ? err(m) : null,
    nOpen: opens.length, errOpen: opens.length ? opens.reduce((a, v) => a + v, 0) / opens.length : null,
    avgEtfMove: y.reduce((a, v) => a + Math.abs(v), 0) / y.length,
  };
}

/** How well "NAV moves with the ETF close" held for the last 30 published NAVs. */
function accuracy(navs, etfDays) {
  const closes = etfDays.filter((d) => d.src !== 'approx');
  const onOrBefore = (d) => { for (let i = closes.length - 1; i >= 0; i--) if (closes[i].date <= d) return closes[i]; return null; };
  const asc = navs.slice(0, 31).reverse();
  const errs = [];
  for (let i = 1; i < asc.length; i++) {
    const c1 = onOrBefore(asc[i - 1].date), c2 = onOrBefore(asc[i].date);
    if (!c1 || !c2) continue;
    if (c2.date < addDaysLocal(asc[i].date, -4)) continue; // ETF history missing for that day
    const est = (asc[i - 1].nav * c2.c) / c1.c;
    errs.push(Math.abs(est / asc[i].nav - 1) * 100);
  }
  if (!errs.length) return null;
  return { count: errs.length, avg: errs.reduce((a, v) => a + v, 0) / errs.length, max: Math.max(...errs) };
}

function addDaysLocal(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * @param s        settings {invested, buyNav, units|null, usMultiplier, buyCutoff, redeemCutoff}
 * @param navs     [{date, nav}] newest first
 * @param etfDays  [{date, o, h, l, c, pc, src}] oldest first
 * @param candles  today's 5-minute prices [{min, o, h, l, c, v}]
 * @param quote    latest SBIGOLD trade {price, time, prevClose}
 * @param spotNow  latest gold spot {ts, price}
 * @param anchors  gold readings near 9:15 am / 3:30 pm [{ts, price, approx}]
 */
export function buildSnapshot({ s, navs, etfDays, candles, quote, n, spotNow, anchors }) {
  const today = n.date;
  const units = s.units ?? (s.buyNav > 0 ? s.invested / s.buyNav : 0);
  const latest = navs[0] || null, previous = navs[1] || null;
  const onOrBefore = (d) => { for (let i = etfDays.length - 1; i >= 0; i--) if (etfDays[i].date <= d) return etfDays[i]; return null; };
  const plOf = (v) => ({ value: v, pl: v - s.invested, plPct: s.invested > 0 ? ((v - s.invested) / s.invested) * 100 : 0 });

  const value = latest ? latest.nav * units : null;
  const pl = value != null ? value - s.invested : null;
  const plPct = pl != null && s.invested > 0 ? (pl / s.invested) * 100 : null;
  const navChange = latest && previous ? latest.nav - previous.nav : null;
  const navChangePct = latest && previous ? (latest.nav / previous.nav - 1) * 100 : null;

  const todayCandles = candles.filter((k) => k.min < CLOSE);
  const q = quote && ist(quote.time).date === today && isTradingDay(today) ? quote : null;
  const prevDay = [...etfDays].reverse().find((d) => d.date < today);
  const etfPrevClose = prevDay?.c ?? q?.prevClose ?? null;

  const estimates = [];
  const base = latest ? onOrBefore(latest.date) : null;
  if (latest && base) {
    let prevPrice = base.c;
    for (let d = nextTradingDay(latest.date); d <= today; d = nextTradingDay(d)) {
      const day = etfDays.find((x) => x.date === d);
      let price, basis, asOf = null;
      if (day) {
        price = day.c;
        basis = day.src === 'nse' ? 'OFFICIAL' : day.src === 'yahoo' ? 'CLOSE' : 'APPROX_CLOSE';
      } else if (d === today && (q || todayCandles.length)) {
        const lastK = todayCandles[todayCandles.length - 1];
        const last = q ? q.price : lastK.c;
        asOf = q ? q.time : istMs(today, lastK.min + 5);
        if (ist(asOf).min >= VWAP_FROM) {
          price = closingVwap(todayCandles) ?? last;
          basis = n.min < CLOSE ? 'VWAP_SO_FAR' : 'APPROX_CLOSE';
        } else {
          price = last;
          basis = 'LIVE';
        }
      } else {
        continue;
      }
      const nav = (latest.nav * price) / base.c;
      estimates.push({ date: d, nav, changePct: (price / prevPrice - 1) * 100, etfPrice: price, etfPrevClose: prevPrice, basis, asOf, ...plOf(nav * units) });
      prevPrice = price;
    }
  }

  // ---- US gold (XAU/USD) ----
  const m = s.usMultiplier;
  const refDay = lastClosedSession(n);
  const lastEst = estimates[estimates.length - 1];
  let chainClose = null;
  if (lastEst && lastEst.date === refDay) chainClose = lastEst.etfPrice;
  else if (base && base.date === refDay && !estimates.length) chainClose = base.c;
  const refClose = chainClose ?? etfDays.find((d) => d.date === refDay)?.c ?? null;
  const refSpot = nearestSpot(anchors, istMs(refDay, CLOSE));
  const changePct = spotNow && refSpot ? (spotNow.price / refSpot.price - 1) * 100 : null;
  const equivalent = refClose != null && changePct != null ? refClose * (1 + (m * changePct) / 100) : null;
  const usDate = nextTradingDay(refDay);
  if (!inSession(n) && latest && base && chainClose != null && equivalent != null && spotNow &&
      !estimates.some((e) => e.date === usDate) && usDate > latest.date) {
    const nav = (latest.nav * equivalent) / base.c;
    estimates.push({ date: usDate, nav, changePct: (equivalent / chainClose - 1) * 100, etfPrice: equivalent, etfPrevClose: chainClose, basis: 'US_GOLD', asOf: spotNow.ts, ...plOf(nav * units) });
  }
  for (const e of estimates) {
    e.isToday = e.basis === 'LIVE' || e.basis === 'VWAP_SO_FAR';
    e.fromUs = e.basis === 'US_GOLD';
    e.publishBy = navDeadline(e.date);
  }
  const days = goldDays(etfDays, anchors, refDay, refClose);
  const gold = { now: spotNow, refDay, refSpot, refClose, changePct, equivalent, multiplier: m, days, fit: goldFit(days, m) };

  const etfEstimates = estimates.filter((e) => !e.fromUs);
  const lastEtf = etfEstimates[etfEstimates.length - 1];
  return {
    n, s, latest, previous, units, value, pl, plPct, navChange, navChangePct, estimates, etfEstimates,
    usEstimate: estimates.find((e) => e.fromUs) || null,
    live: lastEtf && lastEtf.date === today && lastEtf.basis !== 'CLOSE' && lastEtf.basis !== 'OFFICIAL' ? lastEtf : null,
    estimateFor: (d) => estimates.find((e) => e.date === d) || null,
    base, quote, todayQuote: q, todayCandles, etfPrevClose,
    orders: orderNavs(n, s.buyCutoff, s.redeemCutoff, fmtClock),
    accuracy: accuracy(navs, etfDays),
    gold,
  };
}
