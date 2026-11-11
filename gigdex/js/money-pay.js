// Ways to get paid, with no payment processor in the middle: the person's own PayPal.me, Venmo, Cash App, Revolut or
// Monzo, a payment page link, and bank details. Each becomes a Pay button that opens with the amount and the invoice
// number filled in where the service supports it, or plain lines on the invoice. Pure functions: the app and the
// client's invoice page (invoice.html) both use them, so they never touch the store.

// [ISO code, symbol]. The code goes into PayPal links and the European bank QR.
export const CURRENCIES = [['USD', '$'], ['EUR', '€'], ['GBP', '£'], ['AUD', 'A$'], ['CAD', 'C$'], ['NZD', 'NZ$'], ['CHF', 'CHF'], ['SEK', 'kr'], ['NOK', 'kr'], ['DKK', 'kr'], ['JPY', '¥'], ['INR', '₹'], ['ZAR', 'R'], ['SGD', 'S$'], ['HKD', 'HK$'], ['MXN', 'MX$'], ['BRL', 'R$'], ['PLN', 'zł'], ['CZK', 'Kč'], ['AED', 'AED']];
const BY_SYMBOL = { '$': 'USD', '€': 'EUR', '£': 'GBP', 'A$': 'AUD', 'AU$': 'AUD', 'C$': 'CAD', 'CA$': 'CAD', 'NZ$': 'NZD', 'US$': 'USD', '¥': 'JPY', '₹': 'INR', 'R': 'ZAR', 'S$': 'SGD', 'HK$': 'HKD', 'MX$': 'MXN', 'R$': 'BRL', 'zł': 'PLN', 'Kč': 'CZK', 'CHF': 'CHF', 'kr': 'SEK', 'AED': 'AED' };
// The ISO code for a currency symbol ('$' → 'USD'), or a code typed as such; USD when nothing better is known.
export const codeFor = sym => { const t = String(sym ?? '').trim(), u = t.toUpperCase(); return BY_SYMBOL[t] || BY_SYMBOL[u] || (CURRENCIES.some(c => c[0] === u) ? u : 'USD'); };
export const amountStr = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

const clean = s => String(s ?? '').trim();
// "https://paypal.me/name/", "@name", "$name", "name" → "name"
const handle = s => clean(s).replace(/^https?:\/\//i, '').replace(/^(www\.)?[a-z0-9.-]+\.[a-z]{2,}\//i, '').replace(/^[@$]/, '').split(/[/?#\s]/)[0];
const esc = s => encodeURIComponent(s);
const isHttps = s => /^https:\/\/[^\s]+$/i.test(clean(s));

// The payment details a document carries (a copy of the billing settings): every field optional.
export const PAY_FIELDS = ['accountName', 'bankName', 'sortCode', 'accountNumber', 'iban', 'bic', 'paypal', 'venmo', 'cashapp', 'revolut', 'payLink', 'payLinkLabel', 'note'];

// The Pay buttons for a balance: [{ id, label, href }]. ctx = { amount, code, reference }.
export function payButtons(pay = {}, { amount = 0, code = 'USD', reference = '' } = {}) {
  const amt = amountStr(amount), out = [], ref = clean(reference), some = Number(amount) > 0;
  const add = (id, label, href) => { if (href) out.push({ id, label, href }); };
  if (handle(pay.paypal)) add('paypal', 'Pay with PayPal', `https://paypal.me/${esc(handle(pay.paypal))}` + (some ? `/${amt}${code}` : ''));
  if (handle(pay.venmo)) add('venmo', 'Pay with Venmo', `https://venmo.com/${esc(handle(pay.venmo))}?txn=pay` + (some ? `&amount=${amt}` : '') + (ref ? `&note=${esc(ref)}` : ''));
  if (handle(pay.cashapp)) add('cashapp', 'Pay with Cash App', `https://cash.app/$${esc(handle(pay.cashapp))}` + (some ? `/${amt}` : ''));
  const rv = clean(pay.revolut);
  if (handle(rv)) {
    if (/monzo\.me/i.test(rv)) add('monzo', 'Pay with Monzo', `https://monzo.me/${esc(handle(rv))}` + (some ? `/${amt}` : '') + (ref ? `?d=${esc(ref)}` : ''));
    else add('revolut', 'Pay with Revolut', `https://revolut.me/${esc(handle(rv))}`);
  }
  if (isHttps(pay.payLink)) add('link', clean(pay.payLinkLabel).slice(0, 40) || 'Pay online', clean(pay.payLink).replace(/\{amount\}/gi, amt).replace(/\{reference\}/gi, esc(ref)));
  return out;
}

// Bank details as plain lines, in the order a banking app asks for them.
export function bankLines(pay = {}) {
  return [
    clean(pay.accountName) && `Account name: ${clean(pay.accountName)}`,
    clean(pay.bankName) && `Bank: ${clean(pay.bankName)}`,
    clean(pay.sortCode) && `Sort code / routing number: ${clean(pay.sortCode)}`,
    clean(pay.accountNumber) && `Account number: ${clean(pay.accountNumber)}`,
    clean(pay.iban) && `IBAN: ${clean(pay.iban)}`,
    clean(pay.bic) && `BIC / SWIFT: ${clean(pay.bic)}`,
  ].filter(Boolean);
}
export const hasBank = pay => bankLines(pay).length > 0;

// The QR for a bank transfer. With an IBAN it is the European "GiroCode" (EPC069-12) most banking apps there scan to
// fill in the transfer (with the amount only in euro); without one, the details as text, which a phone camera reads
// so they can be copied. '' when there are no bank details.
export function bankQr(pay = {}, { amount = 0, code = 'USD', reference = '' } = {}) {
  const iban = clean(pay.iban).replace(/\s+/g, '').toUpperCase();
  if (iban) {
    return { kind: 'epc', label: 'Scan with your banking app to fill in the transfer', text: ['BCD', '002', '1', 'SCT', clean(pay.bic).replace(/\s+/g, '').toUpperCase(), (clean(pay.accountName) || 'Payee').slice(0, 70), iban, code === 'EUR' && Number(amount) > 0 ? 'EUR' + amountStr(amount) : '', '', '', clean(reference).slice(0, 140)].join('\n') };
  }
  const lines = bankLines(pay);
  if (!lines.length) return null;
  return { kind: 'text', label: 'Scan to copy the bank details', text: [...lines, Number(amount) > 0 ? `Amount: ${amountStr(amount)} ${code}` : '', clean(reference) ? `Reference: ${clean(reference)}` : ''].filter(Boolean).join('\n') };
}

// Anything to show under "How to pay"?
export const hasPay = pay => !!pay && (payButtons(pay, { amount: 1 }).length > 0 || hasBank(pay) || !!clean(pay.note));
