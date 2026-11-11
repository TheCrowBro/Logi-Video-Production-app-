// STUB (studio agent): the session clock. initClockBar(el) shows a strip under the Rolodex while a clock runs.
export function initClockBar(el) { if (el) el.hidden = true; }
export function clockCard(booking) { return document.createElement('div'); }
// Hours worked on a booking by the session clock (breaks taken off), and the running shift if any.
export function clockHours(bookingId) { return 0; }
export function runningShift() { return null; }
