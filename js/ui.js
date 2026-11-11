// Screen rendering: the same sections as the Android app.
import { FUND_NAME, FUND_SHORT, ETF_NAME, ETF_SYMBOL, ISIN } from './config.js';
import { CLOSE, OPEN, ist, inSession, isTradingDay, nextTradingDay, navDeadline, clockShifted, holidayYears } from './market.js';
import {
  esc, fmtInr, fmtNum, fmtSigned, fmtPct, fmtNav, fmtPrice, fmtUsd, fmtDay, fmtDayLong, fmtDayShort, fmtClock,
  fmtClockMs, fmtStamp, fmtWhen, fmtDayRel, fmtDateOrdinal, tone,
} from './fmt.js';
import { BASIS, predictedOpen } from './calc.js';
import { state, etfDays, navSeen } from './data.js';

export const view = { candleDay: null, navRows: 15, showLog: false };

const sym = ETF_SYMBOL;
const card = (title, sub, body, cls = '') =>
  `<section class="card ${cls}"><h2>${esc(title)}</h2>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}${body}</section>`;
const row = (label, value, cls = '', bold = false) =>
  `<div class="row"><span class="lbl">${esc(label)}</span><span class="val ${cls}${bold ? ' b' : ''}">${value}</span></div>`;
const p = (html, cls = '') => `<p class="${cls}">${html}</p>`;
const muted = (html) => p(html, 'muted');
const span = (text, cls) => `<span class="${cls}">${esc(text)}</span>`;
const b = (text) => `<b>${esc(text)}</b>`;

function table(headers, rows, cls = '') {
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map(([v, c]) => `<td class="${c || ''}">${esc(v)}</td>`).join('')}</tr>`).join('');
  return `<div class="tw"><table class="t ${cls}"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

/** Line chart as SVG: one series, optional dashed reference line. [slots] = x positions for a whole session. */
function chart(values, ref, refLabel, left, right, digits, slots = 0) {
  if (values.length < 2) return muted('Not enough data yet.');
  const W = 600, H = 170, top = 14, bottom = H - 22, r = W - 64;
  let lo = Math.min(...values), hi = Math.max(...values);
  if (ref != null) { lo = Math.min(lo, ref); hi = Math.max(hi, ref); }
  if (hi - lo < 1e-9) { hi += 0.5; lo -= 0.5; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const n = Math.max(values.length, slots);
  const x = (i) => (r * i) / Math.max(n - 1, 1);
  const y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  const up = values[values.length - 1] >= (ref ?? values[0]);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const f = (v) => v.toFixed(digits);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">`;
  s += `<line x1="0" y1="${top}" x2="${r}" y2="${top}" class="grid"/><line x1="0" y1="${bottom}" x2="${r}" y2="${bottom}" class="grid"/>`;
  if (ref != null) {
    const yy = y(ref);
    s += `<line x1="0" y1="${yy}" x2="${r}" y2="${yy}" class="ref"/>`;
    s += `<text x="${r - 4}" y="${yy - 5 < top + 12 ? yy + 14 : yy - 5}" text-anchor="end">${esc(refLabel)} ${f(ref)}</text>`;
  }
  s += `<polyline points="${pts}" class="${up ? 'line-up' : 'line-down'}"/>`;
  const vmax = Math.max(...values), vmin = Math.min(...values);
  s += `<text x="${r + 6}" y="${y(vmax) + 4}">${f(vmax)}</text>`;
  if (y(vmin) - y(vmax) > 14) s += `<text x="${r + 6}" y="${y(vmin) + 4}">${f(vmin)}</text>`;
  s += `<text x="0" y="${H - 4}">${esc(left)}</text><text x="${r}" y="${H - 4}" text-anchor="end">${esc(right)}</text>`;
  return s + '</svg>';
}

// ---------- banners ----------

const SOURCE_NAMES = {
  server: 'Gold Tracker server (Apps Script)', 'mfapi.in': 'NAV (mfapi.in)', 'gold-api.com': 'Gold spot (gold-api.com)',
  etf: 'ETF price (Yahoo Finance)', nse: 'NSE daily report', AMFI: 'AMFI NAV', gold: 'Gold spot', 'gold history': 'Past gold prices',
};

function banners(snap) {
  const out = [];
  if (clockShifted()) out.push(['warn', `Test clock: calculations use ${fmtStamp(snap.n.ms)} IST (remove ?at= from the address for real time).`]);
  for (const [k, m] of Object.entries(state.errors)) {
    if ((state.fails[k] || 0) < 2) continue; // one failed request is retried quietly on the next refresh
    const hint = k === 'server' && /failed to fetch|unexpected token|json/i.test(m)
      ? ' (not reachable, or not set up yet: run setup in the Apps Script editor once)' : '';
    out.push(['err', `${SOURCE_NAMES[k] || k}: ${m}${hint}`]);
  }
  for (const [k, m] of Object.entries(state.server?.errors || {})) out.push(['err', `Server, ${SOURCE_NAMES[k] || k}: ${m}`]);
  const tick = state.server?.checks?.tick;
  if (state.server && (!tick || Date.now() - tick > 15 * 60000)) {
    out.push(['warn', `The server's background checks have not run since ${tick ? fmtStamp(tick) : 'setup'}. Open the script and run setup again.`]);
  }
  const years = holidayYears();
  if (!years.has(snap.n.date.slice(0, 4) * 1)) {
    out.push(['warn', `The NSE holiday list covers ${[...years].join(', ')}. Add ${snap.n.date.slice(0, 4)} holidays in Settings so the page knows which days have a NAV.`]);
  }
  return out.map(([c, m]) => `<div class="banner ${c}">${esc(m)}</div>`).join('');
}

// ---------- MF details ----------

function summary(snap) {
  const s = snap.s, n = snap.n, latest = snap.latest;
  const q = snap.todayQuote;
  const sub = q && inSession(n) ? `Live · ${sym} trade at ${fmtClockMs(q.time, true)} · refreshes every 10 s`
    : inSession(n) ? `Market open · waiting for the ${sym} price from the server`
    : q ? `Market closed · last ${sym} trade ${fmtClockMs(q.time, true)}` : 'Market closed';
  const lines = [];
  const line = (label, value, cls = '', note = '', hl = false) =>
    lines.push(`<div class="mf ${hl ? 'hl' : ''}"><div class="mf-l">${esc(label)}</div><div class="mf-r"><div class="mf-v ${cls}">${value}</div>${note ? `<div class="mf-n">${esc(note)}</div>` : ''}</div></div>`);

  const today = n.date, t = n.min;
  const beforeCutoff = isTradingDay(today) && t < s.buyCutoff;
  const orderDate = beforeCutoff ? today : nextTradingDay(today);
  const next = snap.etfEstimates[snap.etfEstimates.length - 1];
  const us = snap.usEstimate;
  const pointsUp = beforeCutoff && t >= OPEN && next?.date === orderDate;
  const pointsToUs = !pointsUp && us && us.date === orderDate;

  line('MF name', esc(`${FUND_SHORT} (${ISIN})`));
  line('Current NAV Price', `₹${fmtNav(latest.nav)}` + (snap.navChangePct != null ? ` (${fmtPct(snap.navChangePct)})` : ''), tone(snap.navChangePct));
  line('Current NAV Date', esc(fmtDateOrdinal(latest.date)));
  line('Total Profit/loss', `${fmtInr(snap.pl, true)} (${fmtPct(snap.plPct)})`, tone(snap.pl));
  if (next) {
    const pct = (next.nav / latest.nav - 1) * 100;
    const basis = next.isToday ? `trade ₹${fmtPrice(next.etfPrice)} at ${next.asOf ? fmtClockMs(next.asOf, true) : ''}` : `${BASIS[next.basis]} ₹${fmtPrice(next.etfPrice)}`;
    line('Next likely NAV (as per live/last-traded ETF price)', `₹${fmtNav(next.nav)} (${fmtPct(pct, 3)})`, tone(pct),
      `NAV of ${fmtDay(next.date)} · ${sym} ${basis} vs ₹${fmtPrice(snap.base.c)} on ${fmtDay(snap.base.date)}`, pointsUp);
    line('Total Profit/loss estimated after next NAV update', `${fmtInr(next.pl, true)} (${fmtPct(next.plPct)})`, tone(next.pl));
  } else {
    line('Next likely NAV (as per live/last-traded ETF price)', '–', '', `Starts with the first ${sym} trade after 9:15 am`);
    line('Total Profit/loss estimated after next NAV update', '–');
  }
  if (us) {
    const g = snap.gold;
    const pct = (us.nav / latest.nav - 1) * 100;
    const mult = Math.abs(g.multiplier - 1) > 1e-9 ? ` × ${fmtNum(g.multiplier, 2)}` : '';
    line(`Likely NAV of ${fmtDay(us.date)} (as per US gold since 3:30 pm)`, `₹${fmtNav(us.nav)} (${fmtPct(pct, 3)})`, tone(pct),
      `Gold ${g.now ? fmtUsd(g.now.price) : ''} at ${fmtClockMs(us.asOf, true)}, ${fmtPct(g.changePct)}${mult} since ${fmtDay(g.refDay)} 3:30 pm → ` +
      `${sym} ≈ ₹${fmtPrice(us.etfPrice)} vs close ₹${fmtPrice(us.etfPrevClose)}. Speculative: assumes ${sym} follows gold.`, pointsToUs);
    line('Total Profit/loss estimated after that NAV', `${fmtInr(us.pl, true)} (${fmtPct(us.plPct)})`, tone(us.pl));
  }
  let text, note, cls = '';
  if (pointsUp) {
    text = '↑ the Next likely NAV above'; cls = 'gold';
    note = `Today's NAV (${fmtDay(today)}) if you buy before ${fmtClock(s.buyCutoff)} with UPI or direct-settlement netbanking, ` +
      `or redeem before ${fmtClock(s.redeemCutoff)}. It keeps moving with ${sym} until the 3:30 pm close.`;
  } else if (pointsToUs) {
    text = '↑ the US-gold based NAV above (speculative)'; cls = 'gold';
    note = `A buy now gets the NAV of ${fmtDayRel(orderDate)}. Until ${sym} trades at 9:15 am, US gold is the only hint; ` +
      `it moves with gold until then, and the real NAV depends on ${fmtDay(orderDate)}'s trading.`;
  } else if (beforeCutoff) {
    text = 'Please wait for 9:15am today to even begin speculating';
    note = `A buy now gets today's NAV (${fmtDay(today)}); it depends on today's ${sym} trading.`;
  } else {
    text = 'Please wait for next trading 9:15am to even begin speculating';
    note = `A buy now gets the NAV of ${fmtDayRel(orderDate)}; its trading starts at 9:15 am. ` +
      (isTradingDay(today) && t < CLOSE ? 'From 3:30 pm the page estimates it from US gold. ' : '') +
      (isTradingDay(today) && t < s.redeemCutoff ? `Redemptions until ${fmtClock(s.redeemCutoff)} still get today's NAV.` : '');
  }
  line('Trading now will entail which NAV ?', esc(text), cls, note);
  return card('MF details', sub, lines.join(''));
}

// ---------- gold spot ----------

function gold(snap) {
  const g = snap.gold;
  let body = '';
  if (!g.now) return card('Gold spot (XAU/USD)', 'gold-api.com', p(state.loading ? 'Loading…' : 'No gold price yet.'));
  const ref = g.refSpot, ch = g.changePct;
  body += `<div class="big">${fmtUsd(g.now.price)} ${ch != null && ref ? span(`${fmtSigned(g.now.price - ref.price, 2)} (${fmtPct(ch)})`, tone(ch)) : ''}</div>`;
  body += muted(`Quote ${esc(fmtStamp(g.now.ts))} · change since ${esc(fmtDay(g.refDay))} 3:30 pm IST`);
  if (!ref) body += p(`No gold price recorded at 3:30 pm on ${esc(fmtDay(g.refDay))}. The server records it at every 3:30 pm close.`);
  else body += row(`At 3:30 pm ${fmtDay(g.refDay)}`, fmtUsd(ref.price) + (ref.approx ? ' (from futures)' : ''));
  if (g.refClose != null) body += row(`${sym} close ${fmtDay(g.refDay)}`, `₹${fmtPrice(g.refClose)}`);
  const q = snap.todayQuote;
  if (inSession(snap.n) && q && snap.etfPrevClose && ch != null) {
    const etfPct = (q.price / snap.etfPrevClose - 1) * 100;
    body += row(`${sym} since ${fmtDay(g.refDay)} close`, `${fmtPct(etfPct)} (₹${fmtPrice(q.price)})`, tone(etfPct));
    body += row(`Gold since ${fmtDay(g.refDay)} 3:30 pm`, fmtPct(ch), tone(ch));
    body += row('Difference', fmtPct(etfPct - ch), tone(etfPct - ch));
  } else if (g.equivalent != null && g.refClose != null && ch != null) {
    const pct = (g.equivalent / g.refClose - 1) * 100;
    const mult = Math.abs(g.multiplier - 1) > 1e-9 ? ` (× ${fmtNum(g.multiplier, 2)})` : '';
    body += row(`${sym} equivalent now${mult}`, `₹${fmtPrice(g.equivalent)} (${fmtPct(pct)})`, tone(pct), true);
    body += muted(`Rough guide to the next opening price at 9:15 am, ${esc(fmtDayRel(nextTradingDay(g.refDay)))}: ${sym} close × gold now ÷ gold at 3:30 pm. ` +
      `Assumes ${sym} moves with US gold; the rupee and Indian demand also move it.`);
  }
  const d0 = g.days[0];
  if (d0) body += p(`${b(`${fmtDay(d0.date)} close vs ${fmtDay(d0.prev)}:`)} ${sym} ${esc(fmtPct(d0.etfPct))}, gold at 3:30 pm ${esc(fmtPct(d0.xauPct))}.`);
  if (g.days.length) {
    const rows = g.days.slice(0, 12).map((d) => {
      const o = predictedOpen(d, g.multiplier);
      return [
        [fmtDayShort(d.date), d.approx ? 'muted' : ''], [fmtPct(d.etfPct), tone(d.etfPct)], [fmtPct(d.xauPct), tone(d.xauPct)],
        [fmtSigned(d.etfPct - d.xauPct, 2), 'muted'],
        [o != null && d.etfOpen != null ? `${fmtSigned((o / d.etfPrevClose - 1) * 100, 2)}/${fmtSigned((d.etfOpen / d.etfPrevClose - 1) * 100, 2)}` : '–', 'muted'],
      ];
    });
    body += muted(`Daily change in %: ${sym} close vs previous close; gold at 3:30 pm IST vs previous 3:30 pm. Open: ${sym}'s 9:15 am open vs previous close, predicted from gold at 9:15 am / actual.`);
    body += table(['Date', sym, 'Gold', 'Diff', 'Open pred/act'], rows, 'num');
  }
  const f = g.fit;
  if (f) {
    let t = `Over ${f.n} sessions: ${sym} moved ${fmtNum(f.avgEtfMove, 2)}% a day on average. Assuming it moves 1:1 with gold was off by ${fmtNum(f.err1, 2)}% a day.`;
    if (f.slope != null && f.n >= 5) t += ` Best-fitting multiplier ${fmtNum(f.slope, 2)}${f.errSlope != null ? ` (off by ${fmtNum(f.errSlope, 2)}%)` : ''}.`;
    if (f.corr != null) t += ` Correlation ${fmtNum(f.corr, 2)}.`;
    if (f.errMultiplier != null) t += ` Your multiplier ${fmtNum(g.multiplier, 2)}: off by ${fmtNum(f.errMultiplier, 2)}%.`;
    if (f.errOpen != null) t += ` Opening price from gold at 9:15 am: off by ${fmtNum(f.errOpen, 2)}% on average (${f.nOpen} days).`;
    if (g.days.some((d) => d.approx)) t += ' Grey dates: gold from COMEX gold futures (Yahoo), loaded once for the days before the server recorded spot prices.';
    body += muted(esc(t));
  }
  return card('Gold spot (XAU/USD)', 'gold-api.com · trades round the clock · refreshes every 10 s', body);
}

// ---------- holding, NAV, estimates, orders ----------

function holding(snap) {
  const s = snap.s;
  let body = `<div class="big">${fmtInr(snap.value)}</div>`;
  body += `<div class="mid ${tone(snap.pl)}">Total P/L ${fmtInr(snap.pl, true)} (${fmtPct(snap.plPct)})</div>`;
  body += row('Invested', fmtInr(s.invested));
  body += row('Units', snap.units.toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + (s.units == null ? ' (invested ÷ buy NAV)' : ''));
  body += row('Buy NAV', fmtNav(s.buyNav));
  body += row('Current NAV', `${fmtNav(snap.latest.nav)} (${fmtDay(snap.latest.date)})`);
  if (snap.live) body += row("At today's projected NAV", `${fmtInr(snap.live.pl, true)} (${fmtPct(snap.live.plPct)})`, tone(snap.live.pl), true);
  return card('Your holding', FUND_NAME, body);
}

function latestNav(snap) {
  const n = snap.latest;
  let body = `<div class="big">${fmtNav(n.nav)} ${snap.navChange != null ? span(`${fmtSigned(snap.navChange, 4)} (${fmtPct(snap.navChangePct)})`, tone(snap.navChange)) : ''}</div>`;
  if (snap.previous) body += muted(`Change from the previous NAV, ${fmtNav(snap.previous.nav)} of ${esc(fmtDay(snap.previous.date))}`);
  const computed = isTradingDay(n.date)
    ? `worked out after the market closed that day, from the 3:30 pm ${sym} closing price`
    : 'a month-end NAV for a day without trading: it only takes off one day of expenses';
  body += p(`${b(`NAV date: ${fmtDayLong(n.date)}`)}, ${esc(computed)}.`);
  const dl = navDeadline(n.date);
  const seen = navSeen().filter((e) => e.date === n.date);
  const when = seen.length
    ? seen.map((e) => `${e.src} showed it ${fmtWhen(e.seenAt)}${e.prevCheck ? ` (not at ${fmtClockMs(e.prevCheck, true)})` : ''}.`).join(' ')
    : 'It was already out when the server started watching.';
  body += p(`${b('Published:')} due on AMFI by ${esc(fmtClockMs(dl))} ${esc(fmtDayRel(ist(dl).date))} at the latest (SEBI deadline for fund-of-funds). ${esc(when)}`);
  return card('Latest NAV', `AMFI / mfapi.in · ISIN ${ISIN}`, body);
}

function nextNav(snap) {
  const latest = snap.latest, base = snap.base;
  let body = '';
  if (!base) return card('Next NAV (estimate)', '', p(`Needs the ${sym} closing price of ${esc(fmtDay(latest.date))}.`));
  if (!snap.etfEstimates.length && !snap.usEstimate) {
    const next = nextTradingDay(latest.date);
    body += p(next === snap.n.date && snap.n.min < OPEN
      ? `${esc(fmtDay(next))} NAV: the projection starts with the first ${sym} trade after 9:15 am.`
      : `${esc(fmtDay(next))} NAV: needs ${sym} prices of ${esc(fmtDay(next))}.`);
  }
  for (const e of snap.estimates) {
    const head = e.isToday ? `${fmtDay(e.date)} NAV (live) ≈ ` : e.fromUs ? `${fmtDay(e.date)} NAV (from US gold) ≈ ` : `${fmtDay(e.date)} NAV ≈ `;
    body += `<div class="est">${esc(head)}${fmtNav(e.nav)} ${span(fmtPct(e.changePct), tone(e.changePct))}</div>`;
    const asOf = e.asOf ? ` at ${fmtClockMs(e.asOf)}` : '';
    const src = e.fromUs ? `gold quote${asOf}: ${sym} ≈ ₹${fmtPrice(e.etfPrice)}` : `${BASIS[e.basis]}, ₹${fmtPrice(e.etfPrice)}${asOf}`;
    body += muted(esc(`From the ${src}, vs ₹${fmtPrice(e.etfPrevClose)} the day before. ` +
      (e.fromUs ? `Speculative until ${sym} trades on ${fmtDay(e.date)}. ` : '') +
      `Published by ${fmtClockMs(e.publishBy)} ${fmtDayRel(ist(e.publishBy).date)}.`));
    body += row('P/L at this NAV', `${fmtInr(e.pl, true)} (${fmtPct(e.plPct)})`, tone(e.pl), true);
    if (snap.pl != null) body += row('Change vs current P/L', fmtInr(e.pl - snap.pl, true), tone(e.pl - snap.pl));
    if (e.isToday && snap.todayCandles.length) {
      const k = snap.todayCandles;
      const lo = (latest.nav * Math.min(...k.map((x) => x.l))) / base.c, hi = (latest.nav * Math.max(...k.map((x) => x.h))) / base.c;
      body += row('Range so far today', `${fmtNav(lo)} – ${fmtNav(hi)}`);
      body += muted(`Projection: if ${sym} closes at this price. NSE sets the close as the average price of trades from 3:00 to 3:30 pm, so it can still move until then.`);
    }
  }
  if (snap.accuracy) {
    body += muted(`Check against the last ${snap.accuracy.count} published NAVs: this method was off by ${fmtNum(snap.accuracy.avg, 3)}% on average, at most ${fmtNum(snap.accuracy.max, 3)}%.`);
  }
  return card('Next NAV (estimate)', 'Latest NAV × ETF price ÷ ETF close on the latest NAV\'s day', body);
}

function orders(snap) {
  let body = '';
  for (const o of snap.orders) {
    const dl = navDeadline(o.navDate);
    const est = snap.estimateFor(o.navDate);
    body += p(`${b(o.title)} · ${esc(o.rule)}`, 'tight');
    body += p(`${span(`→ NAV of ${fmtDayRel(o.navDate)}`, 'gold')}, from that day's 3:30 pm ${sym} close, published by ${esc(fmtClockMs(dl))} ${esc(fmtDayRel(ist(dl).date))}.` +
      (est ? ` Estimate now: ${fmtNav(est.nav)}${est.fromUs ? ' (from US gold)' : ''}.` : ''));
  }
  body += muted('Coin gives the NAV of the day the clearing corporation receives your money. Cut-off times are from Zerodha\'s support page and can be changed in Settings.');
  return card('If you place an order on Coin now', `${fmtDay(snap.n.date)} ${fmtClock(snap.n.min)}`, body);
}

// ---------- ETF ----------

function etf(snap) {
  const q = snap.quote;
  if (!q) return card(`${ETF_NAME} (NSE: ${sym})`, 'Yahoo Finance via the server', p(state.loading ? 'Loading…' : 'No price yet.'));
  const today = snap.n.date;
  const live = ist(q.time).date === today && isTradingDay(today);
  const prev = live ? snap.etfPrevClose : q.prevClose;
  const ch = prev ? q.price - prev : null;
  let body = `<div class="big">₹${fmtPrice(q.price)} ${ch != null ? span(`${fmtSigned(ch, 2)} (${fmtPct((q.price / prev - 1) * 100)})`, tone(ch)) : ''}</div>`;
  const qd = ist(q.time).date;
  body += muted(live && inSession(snap.n) ? `Market open · last trade ${fmtClockMs(q.time, true)}`
    : live ? `Market closed for today · last trade ${fmtClockMs(q.time)}` : `Market closed · last session ${esc(fmtDay(qd))}, last trade ${fmtClockMs(q.time)}`);
  if (prev) body += row('Previous close', `₹${fmtPrice(prev)}`);
  const day = (live ? snap.todayCandles : state.candleCache[qd] || []).filter((k) => k.min < CLOSE);
  if (day.length) body += row('Open · High · Low', `₹${fmtPrice(day[0].o)} · ₹${fmtPrice(Math.max(...day.map((k) => k.h)))} · ₹${fmtPrice(Math.min(...day.map((k) => k.l)))}`);
  const close = etfDays().find((d) => d.date === qd);
  if (close) {
    const label = close.src === 'nse' ? 'Official close (NSE report)' : close.src === 'yahoo' ? 'Closing price' : 'Close (from 3:00–3:30 pm trades)';
    body += row(label, `₹${fmtPrice(close.c)}`);
  }
  if (day.length >= 2) body += chart(day.map((k) => k.c), prev, 'prev', fmtClock(day[0].min), fmtClock(day[day.length - 1].min + 5), 2, 75);
  return card(`${ETF_NAME} (NSE: ${sym})`, 'Price from Yahoo Finance (unofficial), fetched by the server', body);
}

function candles(snap) {
  const days = state.server?.candleDays || [];
  if (!days.length) return '';
  const day = view.candleDay && days.includes(view.candleDay) ? view.candleDay : days[0];
  const i = days.indexOf(day);
  let body = `<div class="pager"><button data-act="candle-older" ${i >= days.length - 1 ? 'disabled' : ''}>◀</button><span>${esc(fmtDayLong(day))}</span><button data-act="candle-newer" ${i <= 0 ? 'disabled' : ''}>▶</button></div>`;
  const list = day === snap.n.date ? snap.todayCandles : state.candleCache[day];
  if (!list) return card('5-minute prices', 'Start and end price of each 5-minute interval, stored per day', body + p('Loading…'));
  const prev = [...etfDays()].reverse().find((d) => d.date < day)?.c;
  if (prev) body += muted(`Previous close ₹${fmtPrice(prev)}`);
  body += muted('Each row is the 5 minutes starting at that time (9:15 am to 3:25 pm). End is green when the price rose within those 5 minutes.');
  const rows = list.filter((k) => k.min >= OPEN && k.min < CLOSE).slice().reverse().map((k) => {
    const pct = prev ? (k.c / prev - 1) * 100 : null;
    return [[fmtClock(k.min).replace(/ (am|pm)$/, ''), ''], [fmtPrice(k.o), ''], [fmtPrice(k.c), tone(k.c - k.o)], [pct != null ? fmtPct(pct) : '', tone(pct)]];
  });
  body += table(['From', 'Start ₹', 'End ₹', 'vs prev close'], rows, 'num');
  return card('5-minute prices', 'Start and end price of each 5-minute interval, stored per day', body);
}

// ---------- history, publication log, status ----------

function history(snap) {
  const navs = state.navs;
  if (!navs.length) return '';
  const data = navs.slice(0, 120).reverse();
  let body = chart(data.map((x) => x.nav), snap.s.buyNav, 'buy', fmtDay(data[0].date), fmtDay(data[data.length - 1].date), 2);
  const closes = new Map(etfDays().map((d) => [d.date, d.c]));
  const rows = navs.slice(0, view.navRows).map((x, i) => {
    const pr = navs[i + 1];
    const ch = pr ? x.nav - pr.nav : null, pct = pr ? (x.nav / pr.nav - 1) * 100 : null;
    return [[fmtDay(x.date), ''], [fmtNav(x.nav), ''], [ch != null ? fmtSigned(ch, 4) : '', tone(ch)], [pct != null ? fmtPct(pct) : '', tone(pct)], [closes.has(x.date) ? fmtPrice(closes.get(x.date)) : '–', 'muted']];
  });
  body += table(['Date', 'NAV', 'Change', '%', 'ETF close'], rows, 'num');
  if (navs.length > view.navRows) body += '<button data-act="more-navs">Show more</button>';
  return card('NAV history', `${navs.length} NAVs from mfapi.in · daily change, and the ETF close they follow`, body);
}

function publicationLog() {
  const seen = navSeen().slice(0, 40);
  if (!seen.length) return card('NAV publication log', 'When each source first showed a new NAV', muted('Nothing yet. The first entry appears when the next NAV is published.'));
  const rows = seen.map((e) => {
    const sameDay = e.prevCheck && ist(e.prevCheck).date === ist(e.seenAt).date;
    const w = e.prevCheck ? (sameDay ? `${fmtClockMs(e.prevCheck, true)} – ${fmtClockMs(e.seenAt, true)}` : `${fmtStamp(e.prevCheck)} – ${fmtClockMs(e.seenAt, true)}`) : `by ${fmtClockMs(e.seenAt, true)}`;
    return [[fmtDay(e.date), ''], [e.src, 'muted'], [`${fmtDay(ist(e.seenAt).date)} ${w}`, '']];
  });
  return card('NAV publication log', 'When each source first showed a new NAV (the server checks every 5 min from 6 pm until it is out)',
    muted('Appeared between the last check without it and the first check with it.') + table(['NAV of', 'Source', 'Appeared'], rows));
}

function status() {
  const c = state.server?.checks || {};
  const w = (ms) => (ms ? fmtStamp(ms) : 'not yet');
  let body = '';
  body += row('Server background check (every minute)', w(c.tick));
  body += row(`${sym} 5-minute prices (server)`, w(c.etf));
  body += row(`${sym} live price`, w(state.quote?.fetched));
  body += row('Gold at 9:15 am / 3:30 pm (server)', w(c.gold));
  body += row('Gold spot (this page)', w(state.fetched['gold-api.com']));
  body += row('NAV, mfapi.in (server)', w(c['mfapi.in']));
  body += row('NAV, AMFI (server)', w(c.AMFI));
  body += row('NAV (this page)', w(state.fetched['mfapi.in']));
  body += muted('The page reads NAVs from mfapi.in and gold from gold-api.com itself. The server (Google Apps Script, free) reads ' +
    `${sym} from Yahoo Finance (its price after 4 pm is NSE's closing price) and NAVs from mfapi.in and AMFI on a schedule, and stores history in a Google Sheet. ` +
    'While this page is open it refreshes every 10 seconds. Estimates are not advice.');
  body += `<button data-act="toggle-log">${view.showLog ? 'Hide' : 'Show'} activity log</button>`;
  if (view.showLog) {
    const log = state.server?.log || [];
    body += `<pre class="log">${log.length ? log.map(([t, m]) => esc(`${t.replace('T', ' ').replace('+05:30', '')}  ${m}`)).join('\n') : 'Nothing yet.'}</pre>`;
  }
  return card('Updates', 'Server: Google Apps Script · Data: Google Sheet "Gold Tracker data"', body);
}

export function render(snap) {
  const n = snap?.n;
  document.getElementById('subtitle').textContent = n
    ? `${FUND_NAME} · ${inSession(n) ? 'market open' : 'market closed'} · ${fmtClock(n.min)} IST`
    : FUND_NAME;
  const el = document.getElementById('content');
  if (!snap || !snap.latest) {
    el.innerHTML = banners(snap || { n: n || ist(Date.now()) }) + card('Getting started', '', p(state.loading ? 'Loading NAV history…' : 'No NAV yet. Tap Refresh.'));
    return;
  }
  el.innerHTML = [
    banners(snap), summary(snap), gold(snap), holding(snap), latestNav(snap), nextNav(snap), orders(snap),
    etf(snap), candles(snap), history(snap), publicationLog(), status(),
  ].join('');
}
