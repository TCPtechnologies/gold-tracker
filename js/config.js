// Apps Script web app (Gold Tracker server). Test against the local stand-in with ?api=http://localhost:8765/exec
export const API_URL = 'https://script.google.com/macros/s/AKfycbzO070ZqiNmBd1sADjnrxsEkgisyviiLUD-F5d_ADt4ui2hna9MscgFaHhxdAt79uAGMA/exec';

export const ISIN = 'INF200K01RP8';
export const SCHEME_CODE = 119788;
export const FUND_NAME = 'SBI Gold Fund – Direct Growth';
export const FUND_SHORT = 'SBI Gold Fund (Direct - Growth)';
export const ETF_NAME = 'SBI Gold ETF';
export const ETF_SYMBOL = 'SBIGOLD';

/** Prefilled holding and rules; changed in Settings and kept in this browser (localStorage). */
export const DEFAULTS = {
  invested: 499975.001,
  buyNav: 49.16,
  units: null,
  usMultiplier: 1,
  buyCutoff: 14 * 60,
  redeemCutoff: 15 * 60,
  extraHolidays: '',
};
