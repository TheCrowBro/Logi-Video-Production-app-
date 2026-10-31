// Print and standalone styles for the call sheet, quote and invoice documents: the same rules serve the printed
// page, the saved web page, and the public invoice page. Pure, so pages without the app can use it.
const RULES = [
  ['', 'margin:0;background:#fff;color:#111;font:13px/1.45 -apple-system,system-ui,"Segoe UI",Roboto,sans-serif'],
  ['.cs-doc', 'max-width:760px;margin:0 auto;padding:28px 24px'],
  ['.cs-head', 'display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid #111;padding-bottom:8px'],
  ['.cs-brand', 'font-weight:700;letter-spacing:.04em'], ['.cs-kicker', 'font-size:11px;letter-spacing:.2em;color:#555'],
  ['.cs-when', 'text-align:right;font-size:12px;color:#444'], ['.cs-when b', 'display:block;font-size:14px;color:#111'],
  ['.cs-doc h2', 'margin:14px 0 2px;font-size:22px'], ['.cs-sub', 'color:#444;margin-bottom:8px'],
  ['.cs-times', 'display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:12px 0'],
  ['.cs-time', 'border:1px solid #ddd;border-radius:8px;padding:8px 10px'], ['.cs-time span', 'display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#666'], ['.cs-time b', 'font-size:18px'],
  ['.cs-sec', 'margin-top:16px;break-inside:avoid'], ['.cs-sec h4', 'margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#555;border-bottom:1px solid #ddd;padding-bottom:3px'],
  ['.cs-kv', 'display:grid;grid-template-columns:140px 1fr;gap:8px;padding:3px 0'], ['.cs-kv span', 'color:#666'], ['.cs-kv a', 'color:#1a4e8a;word-break:break-all'],
  ['table', 'width:100%;border-collapse:collapse;margin:4px 0 8px'], ['th,td', 'text-align:left;vertical-align:top;padding:5px 6px;border-bottom:1px solid #e3e3e3;font-size:12.5px'],
  ['th', 'font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#666'],
  ['.money-parties', 'display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:12px 0'], ['.money-parties h4', 'margin:0 0 4px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#555'],
  ['.money-totals', 'margin:8px 0 0 auto;max-width:320px'], ['.money-totals .cs-kv', 'grid-template-columns:1fr auto;text-align:right'], ['.money-totals .total b', 'font-size:15px'], ['th.num,td.num', 'text-align:right;white-space:nowrap'],
  ['.cs-day', 'font-weight:700;margin:8px 0 2px'], ['.cs-pre', 'white-space:pre-wrap;margin:4px 0'], ['.cs-foot', 'margin-top:22px;padding-top:8px;border-top:1px solid #ddd;font-size:11px;color:#666'],
  ['.pay-buttons', 'display:flex;flex-wrap:wrap;gap:8px;margin:8px 0'],
  ['.pay-btn', 'display:inline-block;padding:9px 14px;border:1.5px solid #1a4e8a;border-radius:10px;color:#1a4e8a;font-weight:700;text-decoration:none;font-size:13px'],
  ['.pay-qr', 'display:flex;gap:14px;align-items:center;margin:8px 0;break-inside:avoid'], ['.pay-qr svg', 'width:112px;height:112px;flex:none;background:#fff;border:1px solid #ddd;border-radius:6px;padding:3px'],
  ['.pay-ref', 'margin:6px 0 0;font-size:12px;color:#444'], ['.paid-stamp', 'display:inline-block;margin:8px 0;padding:6px 12px;border:2px solid #2a8a4a;border-radius:8px;color:#2a8a4a;font-weight:700;letter-spacing:.08em;text-transform:uppercase'],
];
export const docCss = prefix => RULES.map(([sel, decl]) => `${sel ? sel.split(',').map(s => prefix + s.trim()).join(',') : (prefix.trim() || 'body')}{${decl}}`).join('\n');
export const docPrintCss = '@page{margin:14mm}@media print{.cs-doc{padding:0}.pay-btn::after{content:" " attr(href);font-weight:400;font-size:11px;word-break:break-all}}';
