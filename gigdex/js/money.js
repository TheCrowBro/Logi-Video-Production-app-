// STUB (money agent): quotes and invoices.
export function docOf(b, kind) { return null; }
export function docTotals(doc) { return { net: 0, tax: 0, total: 0, paid: 0, due: 0 }; }
export function isOverdue(b) { return false; }
// The Quotes & invoices settings (numbering, tax, payment details) and the price list, for Settings to show.
export function billingPanel() { return document.createElement('div'); }
export function priceListPanel() { return document.createElement('div'); }
