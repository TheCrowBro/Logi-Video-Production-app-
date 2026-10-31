// Ways to get paid, with no payment processor in the middle: links that open the client's PayPal, Venmo, Cash App or
// any payment page (Stripe, Square, Revolut, Monzo…) with the amount filled in, bank details with a scannable EPC
// (SEPA) code, and UPI. Pure functions: the app and the public invoice page both use them.
export const CURRENCIES = [['USD', '$'], ['EUR', '€'], ['GBP', '£'], ['AUD', 'A$'], ['CAD', 'C$'], ['NZD', 'NZ$'], ['CHF', 'CHF '], ['SEK', 'kr '], ['NOK', 'kr '], ['DKK', 'kr '], ['JPY', '¥'], ['INR', '₹'], ['ZAR', 'R'], ['SGD', 'S$'], ['HKD', 'HK$'], ['MXN', 'MX$'], ['BRL', 'R$'], ['PLN', 'zł '], ['CZK', 'Kč '], ['AED', 'AED ']];
const BY_SYMBOL = { '$': 'USD', '€': 'EUR', '£': 'GBP', 'A$': 'AUD', 'C$': 'CAD', 'NZ$': 'NZD', '¥': 'JPY', '₹': 'INR', 'R': 'ZAR', 'S$': 'SGD', 'HK$': 'HKD', 'MX$': 'MXN', 'R$': 'BRL', 'zł': 'PLN', 'Kč': 'CZK', 'CHF': 'CHF', 'kr': 'SEK', 'AED': 'AED' };
export const codeFor = sym => BY_SYMBOL[String(sym || '$').trim()] || 'USD';
export const amountStr = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const clean = s => String(s || '').trim();
const handle = s => clean(s).replace(/^https?:\/\/[^/]+\//i, '').replace(/^[@$]/, '').replace(/\/+$/, '');
const esc = s => encodeURIComponent(s);

export const upiLink = (vpa, { amount, payee = '', reference = '' } = {}) => `upi://pay?pa=${esc(clean(vpa))}&pn=${esc(payee || 'Payee')}&am=${amountStr(amount)}&cu=INR&tn=${esc(reference)}`;

// The Pay buttons for a document: [{ id, label, href, qr }]. Amounts are the balance due, so the client pays exactly that.
export function payLinks(pay = {}, { amount = 0, code = 'USD', reference = '', payee = '' } = {}) {
  const amt = amountStr(amount), out = [];
  if (clean(pay.paypalMe)) out.push({ id: 'paypal', label: 'Pay with PayPal', href: `https://paypal.me/${esc(handle(pay.paypalMe))}/${amt}${code}` });
  if (clean(pay.venmo)) out.push({ id: 'venmo', label: 'Pay with Venmo', href: `https://venmo.com/${esc(handle(pay.venmo))}?txn=pay&amount=${amt}&note=${esc(reference)}` });
  if (clean(pay.cashtag)) out.push({ id: 'cashapp', label: 'Pay with Cash App', href: `https://cash.app/$${esc(handle(pay.cashtag))}/${amt}` });
  if (/^https?:\/\//i.test(clean(pay.payLink))) out.push({ id: 'link', label: clean(pay.payLinkLabel) || 'Pay online', href: clean(pay.payLink).replace(/\{amount\}/gi, amt).replace(/\{reference\}/gi, esc(reference)) });
  if (clean(pay.upi)) out.push({ id: 'upi', label: 'Pay with UPI', href: upiLink(pay.upi, { amount: amt, payee, reference }), qr: 'Scan with any UPI app' });
  return out;
}

// EPC069-12, the "GiroCode" most European banking apps scan to fill in a transfer. Amounts only in euro.
export function epcPayload(pay = {}, { amount = 0, code = 'USD', reference = '' } = {}) {
  const iban = clean(pay.iban).replace(/\s+/g, '').toUpperCase();
  if (!iban) return '';
  return ['BCD', '002', '1', 'SCT', clean(pay.bic).replace(/\s+/g, '').toUpperCase(), (clean(pay.accountName) || 'Payee').slice(0, 70), iban, code === 'EUR' && Number(amount) > 0 ? 'EUR' + amountStr(amount) : '', '', '', clean(reference).slice(0, 140)].join('\n');
}

// The bank-transfer lines printed on an invoice.
export function bankLines(pay = {}) {
  const lines = [];
  if (clean(pay.accountName)) lines.push(`Account name: ${clean(pay.accountName)}`);
  if (clean(pay.iban)) lines.push(`IBAN / account: ${clean(pay.iban)}`);
  if (clean(pay.bic)) lines.push(`BIC / SWIFT / sort code: ${clean(pay.bic)}`);
  if (clean(pay.payment)) lines.push(clean(pay.payment));
  return lines;
}
export const hasPay = pay => payLinks(pay, { amount: 1 }).length > 0 || bankLines(pay).length > 0;
