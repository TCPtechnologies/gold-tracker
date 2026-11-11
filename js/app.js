// Gold Tracker website: start-up, the 10-second refresh and the Settings dialog.
import { setClock, setHolidays, now, isTradingDay, OPEN, CLOSE, expectedNavDate } from './market.js';
import { fmtClock } from './fmt.js';
import { DEFAULTS } from './config.js';
import {
  state, loadSettings, saveSettings, loadNavHistory, pollNavLatest, pollSpot, loadServer, pollLive, loadCandles, etfDays, anchors,
} from './data.js';
import { buildSnapshot } from './calc.js';
import { render, view } from './ui.js';

const params = new URLSearchParams(location.search);
if (params.get('at')) setClock(params.get('at'));
let settings = loadSettings();

function parseHolidays(text) {
  const ok = [], bad = [];
  for (const t of String(text || '').split(/[\s,;]+/).filter(Boolean)) (/^\d{4}-\d{2}-\d{2}$/.test(t) && !isNaN(Date.parse(t)) ? ok : bad).push(t);
  return { ok, bad };
}
const applyHolidays = () => setHolidays(state.server?.holidays, parseHolidays(settings.extraHolidays).ok);
applyHolidays();

function snapshot() {
  const n = now();
  if (!state.navs.length) return { n, latest: null };
  return buildSnapshot({
    s: settings, navs: state.navs, etfDays: etfDays(), candles: state.candleCache[n.date] || [], quote: state.quote,
    n, spotNow: state.spot, anchors: anchors(),
  });
}

let drawQueued = false;
function draw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    try {
      render(snapshot());
    } catch (e) {
      console.error(e);
      document.getElementById('content').insertAdjacentHTML('afterbegin', `<div class="banner err">Display error: ${String(e.message || e).replace(/</g, '&lt;')}</div>`);
    }
  });
}

// ---------- refresh ----------

let lastNavPoll = 0, lastServer = 0, busy = false;

async function refreshServer() {
  lastServer = Date.now();
  await loadServer();
  applyHolidays();
}

async function every10s(force = false) {
  if (busy || (document.hidden && !force)) return;
  busy = true;
  try {
    const n = now();
    const jobs = [pollSpot()];
    const marketWindow = isTradingDay(n.date) && n.min >= OPEN - 1 && n.min < CLOSE + 10;
    if (marketWindow || force) {
      jobs.push(pollLive().then((j) => (j && state.server && j.rev > state.server.rev ? refreshServer() : null)));
    }
    const navDue = !state.navs.length || state.navs[0].date < expectedNavDate(n) || state.errors['mfapi.in'];
    if (force || navDue || Date.now() - lastNavPoll > 10 * 60e3) { lastNavPoll = Date.now(); jobs.push(pollNavLatest()); }
    if (force || state.errors.server || Date.now() - lastServer > 60e3) jobs.push(refreshServer());
    await Promise.allSettled(jobs);
  } finally {
    busy = false;
    draw();
  }
}

async function start() {
  draw();
  await Promise.allSettled([loadNavHistory(), refreshServer(), pollSpot()]);
  state.loading = false;
  lastNavPoll = Date.now();
  draw();
  await pollNavLatest();
  draw();
  setInterval(every10s, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) every10s(); });
}

document.getElementById('refresh').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Checking…';
  await Promise.allSettled([loadNavHistory(true), every10s(true)]);
  btn.disabled = false;
  btn.textContent = 'Refresh';
  draw();
});

document.getElementById('content').addEventListener('click', async (ev) => {
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'more-navs') view.navRows += 30;
  if (act === 'toggle-log') view.showLog = !view.showLog;
  if (act === 'candle-older' || act === 'candle-newer') {
    const days = state.server?.candleDays || [];
    const i = Math.max(0, days.indexOf(view.candleDay ?? days[0]));
    view.candleDay = days[Math.min(days.length - 1, Math.max(0, i + (act === 'candle-older' ? 1 : -1)))];
    draw();
    await loadCandles(view.candleDay);
  }
  draw();
});

// ---------- settings ----------

const dlg = document.getElementById('settings');
const form = document.getElementById('settings-form');
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const numOrNull = (v) => { const t = String(v).trim().replace(/[,₹]/g, ''); return t === '' ? null : Number(t); };

function fillForm(s) {
  form.invested.value = s.invested;
  form.buyNav.value = s.buyNav;
  form.units.value = s.units ?? '';
  form.units.placeholder = s.buyNav > 0 ? `${(s.invested / s.buyNav).toFixed(4)} from amount ÷ NAV` : '';
  form.useMultiplier.checked = !!s.useMultiplier;
  form.multiplierMethod.value = s.multiplierMethod === 'simple' ? 'simple' : 'weighted';
  form.buyCutoff.value = hhmm(s.buyCutoff);
  form.redeemCutoff.value = hhmm(s.redeemCutoff);
  form.extraHolidays.value = s.extraHolidays;
  document.getElementById('settings-error').textContent = '';
  const mu = snapshot().gold?.mult;
  document.getElementById('fit-hint').textContent = mu && mu.n && mu.weighted != null && mu.simple != null
    ? `Now (${mu.n} comparisons): weighted ${mu.weighted.toFixed(2)}, simple average ${mu.simple.toFixed(2)}.` : '';
}

document.getElementById('open-settings').addEventListener('click', () => { fillForm(settings); dlg.showModal(); });
document.getElementById('settings-cancel').addEventListener('click', () => dlg.close());
document.getElementById('settings-reset').addEventListener('click', () => fillForm({ ...DEFAULTS }));

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const fail = (m) => { document.getElementById('settings-error').textContent = m; };
  const invested = numOrNull(form.invested.value), buyNav = numOrNull(form.buyNav.value), units = numOrNull(form.units.value);
  if (!(invested > 0)) return fail('Amount invested: enter a positive number.');
  if (!(buyNav > 0)) return fail('Buy NAV: enter a positive number.');
  if (units !== null && !(units > 0)) return fail('Units: enter a positive number, or leave it empty.');
  const tm = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim()); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
  const bc = tm(form.buyCutoff.value), rc = tm(form.redeemCutoff.value);
  if (bc === null) return fail('Buy cut-off: use HH:MM, for example 14:00.');
  if (rc === null) return fail('Redeem cut-off: use HH:MM, for example 15:00.');
  const h = parseHolidays(form.extraHolidays.value);
  if (h.bad.length) return fail(`Holidays: these are not dates in yyyy-mm-dd form: ${h.bad.join(', ')}`);
  settings = {
    invested, buyNav, units, buyCutoff: bc, redeemCutoff: rc, extraHolidays: form.extraHolidays.value.trim(),
    useMultiplier: form.useMultiplier.checked, multiplierMethod: form.multiplierMethod.value,
  };
  saveSettings(settings);
  applyHolidays();
  dlg.close();
  draw();
});

document.getElementById('cutoff-hint').textContent =
  `Coin (Zerodha support page): UPI and direct-settlement netbanking before ${fmtClock(DEFAULTS.buyCutoff)} get that day's NAV; redemptions before ${fmtClock(DEFAULTS.redeemCutoff)} too.`;

start();
