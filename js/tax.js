// The licence's price with tax, for the places whose law asks shops to show people the whole price before they buy:
// the UK, the EU and Australia. On the website a licence costs 20 US dollars plus the tax where the buyer lives, which
// Stripe's checkout (Link, the seller) works out on the 20 US dollars and adds; so in these places the download page
// and the app show the total. Standard rates on digital services sold to consumers, as at November 2026: when a
// country changes its rate, change it here and in download.html's list (spec 114 checks that they agree).
// Shared by the licence server (cloudflare/worker.mjs, GET /licence/price) and the tests.
export const PRICE = 20; // US dollars, before tax

// Country code (as Cloudflare gives it) → [the place, as a sentence names it; the tax; its rate in %].
export const RATES = {
  GB: ['the UK', 'VAT', 20],
  AU: ['Australia', 'GST', 10],
  AT: ['Austria', 'VAT', 20],
  BE: ['Belgium', 'VAT', 21],
  BG: ['Bulgaria', 'VAT', 20],
  HR: ['Croatia', 'VAT', 25],
  CY: ['Cyprus', 'VAT', 19],
  CZ: ['Czechia', 'VAT', 21],
  DK: ['Denmark', 'VAT', 25],
  EE: ['Estonia', 'VAT', 24],
  FI: ['Finland', 'VAT', 25.5],
  FR: ['France', 'VAT', 20],
  DE: ['Germany', 'VAT', 19],
  GR: ['Greece', 'VAT', 24],
  HU: ['Hungary', 'VAT', 27],
  IE: ['Ireland', 'VAT', 23],
  IT: ['Italy', 'VAT', 22],
  LV: ['Latvia', 'VAT', 21],
  LT: ['Lithuania', 'VAT', 21],
  LU: ['Luxembourg', 'VAT', 17],
  MT: ['Malta', 'VAT', 18],
  NL: ['the Netherlands', 'VAT', 21],
  PL: ['Poland', 'VAT', 23],
  PT: ['Portugal', 'VAT', 23],
  RO: ['Romania', 'VAT', 21],
  SK: ['Slovakia', 'VAT', 23],
  SI: ['Slovenia', 'VAT', 22],
  ES: ['Spain', 'VAT', 21],
  SE: ['Sweden', 'VAT', 25],
};

// The whole price for a country, in US dollars to the cent (the tax is worked out on the 20 US dollars, as the
// checkout does); null where none of these rates applies.
export function withTax(country) {
  const c = String(country || '').toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(RATES, c)) return null;
  const r = RATES[c];
  const cents = PRICE * 100 + Math.round(PRICE * r[2]);
  return { place: r[0], tax: r[1], rate: r[2], total: (cents / 100).toFixed(2) };
}
