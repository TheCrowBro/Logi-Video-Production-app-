// Ways to get paid, with no payment processor in the middle: a list of the systems a freelancer already uses, each
// turned into a Pay button that opens with the amount filled in, or into plain instructions on the invoice, plus bank
// details with a scannable EPC (SEPA) code. Pure functions: the app and the public invoice page both use them.
export const CURRENCIES = [['USD', '$'], ['EUR', '€'], ['GBP', '£'], ['AUD', 'A$'], ['CAD', 'C$'], ['NZD', 'NZ$'], ['CHF', 'CHF '], ['SEK', 'kr '], ['NOK', 'kr '], ['DKK', 'kr '], ['JPY', '¥'], ['INR', '₹'], ['ZAR', 'R'], ['SGD', 'S$'], ['HKD', 'HK$'], ['MXN', 'MX$'], ['BRL', 'R$'], ['PLN', 'zł '], ['CZK', 'Kč '], ['AED', 'AED ']];
const BY_SYMBOL = { '$': 'USD', '€': 'EUR', '£': 'GBP', 'A$': 'AUD', 'C$': 'CAD', 'NZ$': 'NZD', '¥': 'JPY', '₹': 'INR', 'R': 'ZAR', 'S$': 'SGD', 'HK$': 'HKD', 'MX$': 'MXN', 'R$': 'BRL', 'zł': 'PLN', 'Kč': 'CZK', 'CHF': 'CHF', 'kr': 'SEK', 'AED': 'AED' };
export const codeFor = sym => BY_SYMBOL[String(sym || '$').trim()] || 'USD';
export const amountStr = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const clean = s => String(s || '').trim();
const handle = s => clean(s).replace(/^https?:\/\/[^/]+\//i, '').replace(/^[@$]/, '').replace(/\/+$/, '');
const esc = s => encodeURIComponent(s);
const isUrl = s => /^https?:\/\//i.test(clean(s));

// The systems on offer. ask: what to type; label: the button has an editable label; fields: bank details; text: plain
// instructions rather than a link.
export const PAY_TYPES = [
  { id: 'paypal', name: 'PayPal', ask: 'PayPal.Me username', placeholder: 'yourname', blurb: 'A Pay button that opens PayPal with the amount filled in.' },
  { id: 'venmo', name: 'Venmo', ask: 'Venmo username', placeholder: 'yourname', blurb: 'A Pay button that opens Venmo with the amount and the invoice number.' },
  { id: 'cashapp', name: 'Cash App', ask: '$cashtag', placeholder: 'yourname', blurb: 'A Pay button that opens Cash App with the amount filled in.' },
  { id: 'zelle', name: 'Zelle', ask: 'The email or mobile number enrolled with Zelle', blurb: 'Zelle has no payment links, so the invoice says what to send to.' },
  { id: 'stripe', name: 'Stripe payment link', ask: 'Payment link', placeholder: 'https://buy.stripe.com/…', blurb: 'A card payment page from your Stripe dashboard. Let the customer choose the amount, or put {amount} in the link.', label: true },
  { id: 'square', name: 'Square checkout link', ask: 'Checkout link', placeholder: 'https://square.link/…', blurb: 'A card payment page from your Square dashboard.', label: true },
  { id: 'wise', name: 'Wise', ask: 'Wise payment link', placeholder: 'https://wise.com/pay/…', blurb: 'Your Wise "pay me" link.', label: true },
  { id: 'revolut', name: 'Revolut', ask: 'Revolut.Me username', placeholder: 'yourname', blurb: 'A Pay button that opens your Revolut.Me page.' },
  { id: 'monzo', name: 'Monzo', ask: 'Monzo.me username', placeholder: 'yourname', blurb: 'A Pay button that opens Monzo.me with the amount and the invoice number.' },
  { id: 'interac', name: 'Interac e-Transfer', ask: 'The email or mobile number for e-Transfers', blurb: 'Canada. The invoice says what to send to.' },
  { id: 'upi', name: 'UPI', ask: 'UPI ID', placeholder: 'name@bank', blurb: 'India. A Pay button for UPI apps and a QR code with the amount.' },
  { id: 'bank', name: 'Bank transfer', blurb: 'Your account details on the invoice, and a QR code that European banking apps scan to fill in the transfer.', fields: true },
  { id: 'link', name: 'Any other payment page', ask: 'Link', placeholder: 'https://…', blurb: 'Any payment page you have. {amount} and {reference} in the link are filled in.', label: true },
  { id: 'other', name: 'Other instructions', ask: 'What the client should do', blurb: 'Cheque, cash, crypto, anything else: plain words on the invoice.', text: true },
];
export const typeOf = id => PAY_TYPES.find(t => t.id === id) || PAY_TYPES[PAY_TYPES.length - 1];
export const summaryOf = m => (m.type === 'bank' ? [m.accountName, m.iban, m.bic].filter(Boolean).join(' · ') : [m.label, m.value].filter(Boolean).join(' · '));

// The list of ways, also from the older fixed fields (paypalMe, venmo, cashtag, payLink, upi, iban…) so nothing set
// before is lost and links made earlier still render.
export function methodsOf(pay = {}) {
  if (Array.isArray(pay.methods)) return pay.methods;
  if (Array.isArray(pay.payMethods)) return pay.payMethods;
  const out = [];
  if (clean(pay.paypalMe)) out.push({ type: 'paypal', value: pay.paypalMe });
  if (clean(pay.venmo)) out.push({ type: 'venmo', value: pay.venmo });
  if (clean(pay.cashtag)) out.push({ type: 'cashapp', value: pay.cashtag });
  if (clean(pay.payLink)) out.push({ type: 'link', value: pay.payLink, label: pay.payLinkLabel });
  if (clean(pay.upi)) out.push({ type: 'upi', value: pay.upi });
  if (clean(pay.iban) || clean(pay.accountName) || clean(pay.bic)) out.push({ type: 'bank', accountName: pay.accountName, iban: pay.iban, bic: pay.bic });
  return out;
}

export const upiLink = (vpa, { amount, payee = '', reference = '' } = {}) => `upi://pay?pa=${esc(clean(vpa))}&pn=${esc(payee || 'Payee')}&am=${amountStr(amount)}&cu=INR&tn=${esc(reference)}`;
const DEFAULT_LABEL = { paypal: 'Pay with PayPal', venmo: 'Pay with Venmo', cashapp: 'Pay with Cash App', revolut: 'Pay with Revolut', monzo: 'Pay with Monzo', upi: 'Pay with UPI', stripe: 'Pay by card', square: 'Pay by card', wise: 'Pay with Wise', link: 'Pay online' };
export const labelFor = m => clean(m.label) || DEFAULT_LABEL[m.type] || 'Pay online';
// The address a Pay button opens, with the balance due and the invoice number filled in; '' for ways with no link.
export function linkFor(m, { amount = 0, code = 'USD', reference = '', payee = '' } = {}) {
  const amt = amountStr(amount), v = clean(m.value);
  switch (m.type) {
    case 'paypal': return v ? `https://paypal.me/${esc(handle(v))}/${amt}${code}` : '';
    case 'venmo': return v ? `https://venmo.com/${esc(handle(v))}?txn=pay&amount=${amt}&note=${esc(reference)}` : '';
    case 'cashapp': return v ? `https://cash.app/$${esc(handle(v))}/${amt}` : '';
    case 'revolut': return v ? `https://revolut.me/${esc(handle(v))}` : '';
    case 'monzo': return v ? `https://monzo.me/${esc(handle(v))}/${amt}?d=${esc(reference)}` : '';
    case 'upi': return v ? upiLink(v, { amount: amt, payee, reference }) : '';
    case 'stripe': case 'square': case 'wise': case 'link': return isUrl(v) ? v.replace(/\{amount\}/gi, amt).replace(/\{reference\}/gi, esc(reference)) : '';
    default: return '';
  }
}
// The Pay buttons for a document: [{ id, label, href, qr }].
export const payLinks = (pay, ctx) => methodsOf(pay).map(m => { const href = linkFor(m, ctx); return href ? { id: m.type, label: labelFor(m), href, qr: m.type === 'upi' ? 'Scan with any UPI app' : '' } : null; }).filter(Boolean);
const bankLinesOf = m => [clean(m.accountName) && `Account name: ${clean(m.accountName)}`, clean(m.iban) && `IBAN / account: ${clean(m.iban)}`, clean(m.bic) && `BIC / SWIFT / sort code: ${clean(m.bic)}`].filter(Boolean);
// The plain lines for the ways that are not links, then the free text, printed under the buttons.
export function payTexts(pay = {}) {
  const lines = methodsOf(pay).flatMap(m => { const v = clean(m.value); switch (m.type) {
    case 'zelle': return v ? [`Zelle: ${v}`] : [];
    case 'interac': return v ? [`Interac e-Transfer to ${v}`] : [];
    case 'other': return v ? [v] : [];
    case 'bank': return bankLinesOf(m);
    default: return []; } });
  if (clean(pay.payment)) lines.push(clean(pay.payment));
  return lines;
}
export const bankLines = payTexts; // older name
// EPC069-12, the "GiroCode" most European banking apps scan to fill in a transfer. Amounts only in euro.
export function epcPayload(pay = {}, { amount = 0, code = 'USD', reference = '' } = {}) {
  const m = methodsOf(pay).find(x => x.type === 'bank') || (pay.iban ? pay : null);
  const iban = m ? clean(m.iban).replace(/\s+/g, '').toUpperCase() : '';
  if (!iban) return '';
  return ['BCD', '002', '1', 'SCT', clean(m.bic).replace(/\s+/g, '').toUpperCase(), (clean(m.accountName) || 'Payee').slice(0, 70), iban, code === 'EUR' && Number(amount) > 0 ? 'EUR' + amountStr(amount) : '', '', '', clean(reference).slice(0, 140)].join('\n');
}
export const hasPay = pay => payLinks(pay, { amount: 1 }).length > 0 || payTexts(pay).length > 0;
