// A kit list from somewhere else, understood: which row holds the headings, which column is what, and each row turned
// into an equipment item Vdex can keep. js/table-read.js supplies the rows as plain text; js/gear-import-ui.js shows
// the guesses, lets every one be changed, and adds nothing until the person says so. Nothing here draws or stores.
//
// A column is recognised by its heading first and by what is in it second, so a file never seen before still comes
// out mostly right: money with currency signs is a value, short unique codes with digits are serial numbers, a few
// repeated words that name kinds of kit are categories, small whole numbers are quantities.
//
// Where the headings come from (docs/developers.md lists the sources): Vdex's own asset register; the export and
// import columns Sortly, Cheqroom, EZOfficeInventory and Rentman document; the usual columns of the home and gear
// inventory templates for Excel, Numbers, Google Sheets, Airtable and Notion; and the make / model / serial /
// replacement value layout insurers and rental houses ask for on an equipment schedule. A few of the commonest
// German, French, Spanish, Dutch and Italian headings are here too, since a decimal comma usually comes with them.
import { CATEGORIES } from './pages/gear.js';

// What a column can be. The first entry of each pair is the name used in a mapping; '' leaves the column out.
export const TARGETS = [
  ['', 'Skip this column'], ['name', 'Name'], ['make', 'Make or brand (joins the name)'], ['model', 'Model (joins the name)'], ['category', 'Category'],
  ['serial', 'Serial number'], ['qty', 'Quantity'], ['value', 'Value (each)'], ['total', 'Value of the whole row (shared over the quantity)'], ['location', 'Where it is'],
  ['purchased', 'Purchased (date)'], ['warranty', 'Warranty until (date)'], ['serviceEvery', 'Service every (months)'], ['firmware', 'Firmware version'], ['lastService', 'Last service (date)'], ['notes', 'Notes'],
];
const CAPS = { name: 200, category: 60, serial: 80, location: 120, firmware: 60, notes: 2000 };

/* --------------------------------- headings --------------------------------- */
// A heading as it is compared: lower case, accents and bracketed units gone ("Value each (£)" → "value each"). Only
// its opening is looked at: no heading is longer, and a cell of thousands of brackets must not slow the reading.
export const headKey = s => String(s == null ? '' : s).slice(0, 200).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9#/]+/g, ' ').trim();

// Kind → lists of headings, the surest first: a file with both "Replacement value" and "Purchase price" gives the
// item's value from the first. 'folder' is a place or a category, decided by what is in it; 'skip' is known and unwanted.
const HEADINGS = {
  name: [['item', 'item name', 'name', 'entry name', 'asset name', 'equipment', 'equipment name', 'gear', 'kit', 'product name', 'article', 'artikel', 'bezeichnung', 'designation', 'nom', 'nombre', 'naam', 'nome', 'articolo', 'what'],
    ['description', 'item description', 'asset description', 'equipment description', 'product', 'title', 'asset', 'beschreibung', 'descripcion', 'descrizione', 'omschrijving']],
  make: [['make', 'brand', 'manufacturer', 'maker', 'mfr', 'mfg', 'hersteller', 'marke', 'marque', 'fabricant', 'marca', 'fabricante', 'merk']],
  model: [['model', 'model name', 'model number', 'model no', 'model #', 'product model number', 'modell', 'modele', 'modelo', 'modello']],
  category: [['category', 'categories', 'item category', 'equipment category', 'asset category', 'kategorie', 'categorie', 'categoria'],
    ['type', 'item type', 'equipment type', 'type of equipment', 'asset type', 'product type', 'product group', 'group', 'department', 'class', 'section', 'typ', 'gruppe']],
  folder: [['primary folder', 'folder', 'folder name', 'parent folder'], ['subfolder', 'sub folder', 'subfolder level1', 'subfolder level 1']],
  serial: [['serial number', 'serial', 'serial no', 'serial #', 'serial num', 'serial numbers', 's/n', 'sn', 's n', 'serial number/id', 'serial/id', 'seriennummer', 'serien nr', 'seriennr', 'numero de serie', 'n de serie', 'no de serie', 'serienummer', 'numero di serie', 'matricola'],
    ['asset identification number', 'identification number', 'imei']],
  qty: [['quantity', 'qty', 'quantity owned', 'count', 'units', 'no of units', 'number of units', 'pcs', 'pieces', 'how many', 'owned', 'current quantity', 'initial stock quantity', 'stock', 'in stock', 'stock level', 'on hand', 'anzahl', 'menge', 'stuck', 'stk', 'quantite', 'qte', 'cantidad', 'aantal', 'quantita']],
  value: [['replacement value', 'replacement cost', 'replacement value each', 'replacement price', 'replacement', 'replacement charge', 'insured value', 'sum insured', 'value each', 'unit value', 'new for old value', 'new replacement value', 'replacement cost new', 'neuwert', 'wiederbeschaffungswert', 'valeur de remplacement', 'valeur a neuf', 'valor de reposicion', 'vervangingswaarde'],
    ['value', 'current value', 'estimated value', 'estimated current value', 'price', 'unit price', 'cost', 'unit cost', 'worth', 'amount', 'wert', 'valeur', 'valor', 'waarde', 'valore', 'prix', 'preis', 'precio', 'prijs', 'prezzo'],
    ['purchase price', 'purchase cost', 'cost price', 'price paid', 'paid', 'purchase value', 'original cost', 'original price', 'original value', 'bought for', 'kaufpreis', 'prix d achat', 'precio de compra', 'aankoopprijs', 'prezzo di acquisto']],
  total: [['total', 'total value', 'total cost', 'total price', 'line total', 'extended value', 'extended price', 'ext value', 'total replacement value', 'total stock cost', 'subtotal', 'gesamt', 'gesamtwert', 'summe', 'totaal']],
  location: [['location', 'where', 'where it is', 'where kept', 'kept in', 'kept at', 'stored', 'stored at', 'stored in', 'storage', 'storage location', 'place', 'location name', 'default location name', 'home location', 'case', 'bin', 'shelf', 'room', 'site', 'standort', 'lagerort', 'ort', 'emplacement', 'lieu', 'ubicacion', 'locatie', 'posizione']],
  purchased: [['purchased', 'purchase date', 'date purchased', 'purchased on', 'date of purchase', 'purchase', 'bought', 'bought on', 'date bought', 'buy date', 'acquired', 'date acquired', 'acquisition date', 'kaufdatum', 'gekauft am', 'date d achat', 'fecha de compra', 'aankoopdatum', 'data di acquisto']],
  warranty: [['warranty until', 'warranty', 'warranty date', 'warranty expiry', 'warranty expires', 'warranty expiration', 'warranty end', 'warranty end date', 'warranty expiry date', 'warranty expiration date', 'garantie', 'garantie bis', 'garantia', 'garanzia']],
  serviceEvery: [['service every', 'service interval', 'service every months', 'service interval months', 'service months', 'maintenance interval']],
  firmware: [['firmware', 'firmware version', 'fw', 'fw version', 'software version']],
  lastService: [['last service', 'last serviced', 'last service date', 'serviced', 'last maintenance', 'last checked', 'last calibration']],
  notes: [['notes', 'note', 'comments', 'comment', 'remarks', 'remark', 'internal remark', 'details', 'memo', 'info', 'bemerkung', 'bemerkungen', 'notizen', 'remarques', 'notas', 'opmerkingen']],
  skip: [['id', '#', 'no', 'pos', 'line', 'item no', 'item number', 'item #', 'asset #', 'asset no', 'asset number', 'asset id', 'asset tag', 'tag', 'tags', 'sku', 'code', 'barcode', 'codes', 'qr code', 'upc', 'sortly id', 'entry type', 'unit', 'min level', 'max level', 'photo', 'photos', 'photo urls', 'image', 'picture', 'display picture url', 'document attachments', 'kind', 'kit name', 'vendor', 'supplier', 'purchased from', 'where purchased', 'store', 'retailer', 'subgroup', 'sub group', 'subcategory', 'sub category', 'status', 'condition', 'owner', 'assigned to', 'custodian', 'weight', 'retire', 'retired on', 'day rate', 'daily rate', 'rental price', 'rental rate', 'rate', 'price per day', 'week rate', 'hire rate', 'hire price', 'tagespreis', 'tagesmiete', 'mietpreis', 'discount', 'vat', 'tax', 'currency', 'year', 'age', 'link', 'url', 'website', 'flag', 'rental/sales', 'residual value', 'book value', 'depreciated value', 'salvage value', 'location #', 'location identification number', 'retire comments', 'reason for retiring', 'transaction note']],
};
const HEAD = new Map();
for (const [kind, ranks] of Object.entries(HEADINGS)) ranks.forEach((list, rank) => list.forEach(w => { if (!HEAD.has(w)) HEAD.set(w, { kind, rank }); }));
// A heading not in the lists, read by the words in it ("Camera serial no.", "Est. replacement value", "Date of last service").
const LOOSE = [
  [/\b(photo|image|picture|barcode|qr|url|attachment)/, 'skip', 0], [/\bsub ?folder/, 'folder', 2], [/\bsub ?(group|categor)/, 'skip', 0], [/\b(rental|hire|day|daily|weekly|week) (rate|price|charge|cost)\b/, 'skip', 0],
  [/\bserial\b|\bs\/n\b/, 'serial', 0], [/\blast (service|maintenance|calibration|check)/, 'lastService', 0], [/\bservice (every|interval)/, 'serviceEvery', 0], [/\bwarranty|\bgarantie/, 'warranty', 0], [/\bfirmware\b/, 'firmware', 0],
  [/\b(purchase|purchased|bought|acquired|acquisition)\b.*\bdate\b|\bdate\b.*\b(purchase|purchased|bought|acquired)\b/, 'purchased', 0],
  [/\btotal\b|\bextended\b/, 'total', 0], [/\b(residual|book|depreciated|salvage)\b/, 'skip', 0], [/\breplacement\b|\binsured (value|sum|amount)/, 'value', 0], [/\b(purchase|purchased|bought|paid|original)\b.*\b(price|cost|value|amount)\b/, 'value', 2], [/\b(value|price|cost|worth)\b/, 'value', 1],
  [/\b(qty|quantity|quantities)\b/, 'qty', 0], [/\b(location|stored|storage)\b/, 'location', 0], [/\bcategor/, 'category', 0], [/\bfolder\b/, 'folder', 0], [/\bmodel\b/, 'model', 0], [/\b(brand|manufacturer|make)\b/, 'make', 0],
  [/\b(notes?|comments?|remarks?)\b/, 'notes', 0], [/\b(item|equipment|product|asset) (name|description)\b/, 'name', 0], [/\bdescription\b/, 'name', 1], [/\bname\b/, 'name', 1], [/\btype\b/, 'category', 1],
];
export function headingKind(text) {
  const k = headKey(text); if (!k) return null;
  if (HEAD.has(k)) return HEAD.get(k);
  for (const [re, kind, rank] of LOOSE) if (re.test(k)) return { kind, rank, loose: true };
  return null;
}

/* ---------------------------------- values ---------------------------------- */
const NOTHING = /^(?:n\/?a|n\.a\.?|none|nil|null|unknown|not known|tbc|tbd|tba|\?+|-+|–|—|\.+|no serial|no s\/n|not applicable)$/i;
export const isNothing = s => { const t = String(s == null ? '' : s).trim(); return !t || NOTHING.test(t); };

// Money or any number as typed: "£1,299.00", "1.299,00 €", "1 299", "1'299.50", "USD 450", "450,-". → a number, ''
// for nothing ("n/a", "-"), or NaN when it is not a number. The last of a comma and a point is the decimal mark. One
// alone, followed by exactly three digits, separates thousands: always for a comma, and for a point when the column
// writes its numbers the continental way (numberStyle below). No amount, date or quantity is long (LONGEST), so longer
// text is not one, without a pattern being tried on it: a cell made of thousands of dashes or spaces costs nothing.
const LONGEST = 60;
const SYMBOLS = /[£$€¥₹₩₽₺₪฿₫₴₦₱]/g, CODES = '(?:usd|us|gbp|eur|aud|cad|nzd|chf|sek|nok|dkk|jpy|inr|zar|sgd|hkd|pln|czk|kwd|bhd|omr|jod|tnd|lyd|iqd|kr|zl|rs)';
const CODE_BEFORE = new RegExp(`^${CODES}\\.?\\s*(?=[\\d(+-])`, 'i'), CODE_AFTER = new RegExp(`(\\d)\\s*${CODES}\\.?$`, 'i');
const hasCurrency = s => /[£$€¥₹₩₽₺₪฿₫₴₦₱]/.test(s) || CODE_BEFORE.test(s.trim()) || CODE_AFTER.test(s.trim());
export function parseAmount(raw, { dotThousands = false } = {}) {
  let s = String(raw == null ? '' : raw).trim(); if (isNothing(s)) return '';
  if (s.length > LONGEST) return NaN;
  s = s.replace(/\b(?:us|au|a|ca|c|nz|hk|s|r)\$/i, '').replace(SYMBOLS, '').trim().replace(CODE_BEFORE, '').replace(CODE_AFTER, '$1')
    .replace(/[\s\u00A0\u2009\u202F'’_]/g, '').replace(/^\((.*)\)$/, '$1').replace(/(?:each|ea|pcs?)\.?$/i, '').replace(/[.,]?-+$/, ''); // "450,-" and "12.-"
  if (!/^[+-]?[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;
  const neg = s[0] === '-'; s = s.replace(/^[+-]/, '');
  const dot = s.lastIndexOf('.'), comma = s.lastIndexOf(',');
  let dec = '';
  if (dot >= 0 && comma >= 0) dec = dot > comma ? '.' : ',';
  else if (comma >= 0) dec = s.indexOf(',') !== comma || /^[1-9]\d{0,2},\d{3}$/.test(s) ? '' : ',';
  else if (dot >= 0) dec = s.indexOf('.') !== dot || (dotThousands && /^[1-9]\d{0,2}\.\d{3}$/.test(s)) ? '' : '.';
  const cut = dec ? s.lastIndexOf(dec) : s.length, n = Number(s.slice(0, cut).replace(/[.,]/g, '') + (dec ? '.' + s.slice(cut + 1) : ''));
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}
// How a column writes its numbers, worked out from its typed values only (a number cell of an .xlsx is a number
// already and is never guessed at: buildItems and profile leave those out). Points separate thousands when a value
// ends in a comma and one or two digits ("1.299,00", "12,50"), or when every value with a point has groups of exactly
// three digits after it ("1.299", "12.500") and none uses a comma that way: most money is not written to three
// decimal places. The money that is (the dinars and the Omani rial) keeps its point as the decimal mark when the
// column says so, by a currency code in its heading or beside a value ("Value (KWD)", "450.500 KWD").
const THREE_PLACES = /\b(?:kwd|bhd|omr|jod|tnd|lyd|iqd)\b/i;
export function numberStyle(values, { heading = '' } = {}) {
  const typed = values.map(x => String(x == null ? '' : x)).filter(x => x.length <= LONGEST), v = typed.map(x => x.replace(/[^\d.,]/g, '')).filter(Boolean);
  const pointDecimals = v.some(x => /\.\d{1,2}$/.test(x)), commaDecimals = v.some(x => /,\d{1,2}$/.test(x));
  const dotted = v.filter(x => x.includes('.')), threePlaces = THREE_PLACES.test(String(heading || '').slice(0, 200)) || typed.some(x => THREE_PLACES.test(x));
  return { dotThousands: !pointDecimals && (commaDecimals || !threePlaces && dotted.length > 0 && dotted.every(x => /^[1-9]\d{0,2}(?:\.\d{3})+$/.test(x)) && !v.some(x => /,\d{3}/.test(x))) };
}

// Dates, in the ways they are written: 2024-03-01, 01/03/2024, 3/1/24, 1.3.2024, 1 Mar 2024, March 1, 2024, Mar 2024,
// and the day number a spreadsheet stores (45352). → '2024-03-01', '' for nothing, null when not understood.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => { y = Number(y); m = Number(m); d = Number(d); if (y < 100) y += y <= (new Date().getFullYear() % 100) + 10 ? 2000 : 1900; const t = new Date(Date.UTC(y, m - 1, d)); return y >= 1900 && y <= 2100 && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null; };
const monthOf = w => { const i = MONTHS.indexOf(String(w).slice(0, 3).toLowerCase()); return i < 0 ? 0 : i + 1; };
// Whether this device writes the day or the month first, for 03/04/2024 when nothing in the column settles it.
export const localeDayFirst = () => { try { const p = new Intl.DateTimeFormat().formatToParts(new Date(2020, 11, 31)).map(x => x.type); return p.indexOf('day') < p.indexOf('month'); } catch { return true; } };
// 'dmy' or 'mdy' for a column: a first number over 12 is a day, a second number over 12 makes the first a month.
export function dateOrder(values) {
  let dmy = 0, mdy = 0;
  for (const v of values) { const m = String(v).trim().match(/^(\d{1,2})[/\-](\d{1,2})[/\-]\d{2,4}\b/); if (!m) continue; if (Number(m[1]) > 12) dmy++; else if (Number(m[2]) > 12) mdy++; }
  return dmy > mdy ? 'dmy' : mdy > dmy ? 'mdy' : localeDayFirst() ? 'dmy' : 'mdy';
}
export function parseDate(raw, order = 'dmy') {
  const s = String(raw == null ? '' : raw).trim(); if (isNothing(s)) return '';
  if (s.length > LONGEST) return null;
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/))) return iso(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})\.?$/))) return iso(m[3], m[2], m[1]); // points are written day first
  if ((m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})(?:\s.*)?$/))) return order === 'mdy' ? iso(m[3], m[1], m[2]) : iso(m[3], m[2], m[1]);
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]+([A-Za-z]{3,9})\.?,?[\s\-/.]+(\d{2,4})$/)) && monthOf(m[2])) return iso(m[3], monthOf(m[2]), m[1]);
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/)) && monthOf(m[1])) return iso(m[3], monthOf(m[1]), m[2]);
  if ((m = s.match(/^([A-Za-z]{3,9})\.?[\s\-/]+(\d{4})$/)) && monthOf(m[1])) return iso(m[2], monthOf(m[1]), 1);
  if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) return iso(m[1], m[2], 1);
  if (/^\d{5}(?:\.\d+)?$/.test(s)) { const n = Math.floor(Number(s)); if (n >= 18264 && n <= 73415) { const d = new Date(Date.UTC(1899, 11, 30) + n * 864e5); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); } } // 1950 to 2100 as a spreadsheet's day number
  return null;
}
// → { n, note } : a whole number of at least 1; note says what was done with anything else.
export function parseQty(raw) {
  const s = String(raw == null ? '' : raw).trim(); if (isNothing(s)) return { n: 1 };
  const v = s.length > LONGEST ? NaN : parseAmount(s.replace(/^[x×]\s*/i, '').replace(/\s*(?:x|×|pcs?|pieces?|units?|ea|each|off|st|stk|stuck|stück)\.?$/i, ''));
  if (v === '' || Number.isNaN(v)) return { n: 1, note: `“${s.slice(0, 40)}” is not a quantity, so 1 is used` };
  if (v < 1) return { n: 1, note: `the quantity is ${v}, so it is added as 1` };
  if (!Number.isInteger(v)) return { n: Math.floor(v), note: `the quantity ${v} is taken as ${Math.floor(v)}` };
  return v > 9999 ? { n: 9999, note: 'the quantity is taken as 9999, the most an item can have' } : { n: v };
}
// "12", "12 months", "1 year", "annually" → months; '' for nothing; null when not understood. The words are looked
// up in a Map, never in a plain object: a cell that says "constructor" is then simply a word Vdex does not know.
const MONTH_WORDS = new Map([['annual', 12], ['annually', 12], ['yearly', 12], ['every year', 12], ['once a year', 12], ['twice a year', 6], ['six monthly', 6], ['biannual', 6], ['quarterly', 3], ['monthly', 1], ['every month', 1]]);
export function parseMonths(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase(); if (isNothing(s) || s === '0') return '';
  if (s.length > LONGEST) return null;
  let m;
  if ((m = s.match(/^(?:every\s+)?(\d{1,3})\s*(?:m|mo|mos|mth|mths|months?|monthly)?$/))) return Number(m[1]);
  if ((m = s.match(/^(?:every\s+)?(\d{1,2})\s*(?:y|yr|yrs|years?|yearly)$/))) return Number(m[1]) * 12;
  return MONTH_WORDS.get(s) ?? null;
}

/* -------------------------------- categories -------------------------------- */
// Words people file kit under → Vdex's own categories ("Mics" is Audio, "Tripods & heads" is Support). A category
// that is none of these is kept as typed, and shows on the Equipment page as a category of its own.
const CAT_WORDS = {
  Camera: 'camera cameras cam cams|camera body|camera bodies|body|bodies|cine camera|cinema camera|cinema cameras|video camera|video cameras|camcorder|dslr|dslrs|mirrorless|action camera|action cam|stills camera|photo camera|camera package|kamera|kameras|camara|camaras',
  Lens: 'lens lenses glass optics prime primes zoom zooms|prime lens|prime lenses|zoom lens|zoom lenses|cine lens|cine lenses|objektiv|objektive|objectif|objectifs|objetivo|objetivos|lente|lentes',
  Lighting: 'light lights lighting led leds strobe strobes flash flashes lamp lamps fixture fixtures modifier modifiers softbox softboxes tungsten hmi|led light|led lights|led panel|led panels|light fixture|lighting fixture|light modifier|light modifiers|licht|beleuchtung|lumiere|eclairage|iluminacion',
  Audio: 'audio sound mic mics microphone microphones recorder recorders lav lavs lavalier lavaliers boom headphones mixer mixers|audio recorder|audio recorders|wireless audio|radio mic|radio mics|audio gear|sound gear|sound equipment|audio equipment|ton|son|sonido',
  Support: 'support tripod tripods monopod monopods head heads gimbal gimbals stabiliser stabilisers stabilizer stabilizers stabilisation stabilization slider sliders rig rigs steadicam easyrig sticks legs|camera support|fluid head|fluid heads|shoulder rig|stativ|stative',
  Grip: 'grip grips stand stands clamp clamps rigging flag flags dolly dollies jib jibs crane cranes track sandbag sandbags|grip equipment|light stand|light stands|c stand|c stands|apple box|apple boxes|grip and electric',
  Drone: 'drone drones uav uavs uas aerial aerials quadcopter multirotor drohne drohnen',
  Monitoring: 'monitor monitors monitoring evf viewfinder viewfinders|video village|wireless video|video transmitter|video transmission|monitor recorder|recorder monitor',
  Power: 'power battery batteries charger chargers generator generators|v mount|v lock|v lok|power supply|power supplies|power distribution|akku|akkus|batterie|batterien',
  Media: 'media card cards cfexpress cfast storage drive drives ssd ssds memory|memory card|memory cards|sd card|sd cards|hard drive|hard drives|recording media|speicherkarten',
  Accessories: 'accessory accessories cable cables filter filters case cases bag bags adapter adapters adaptor adaptors cage cages consumable consumables|matte box|follow focus|lens accessory|lens accessories|camera accessory|camera accessories|zubehor|accessoire|accessoires|accesorios',
  Other: 'other others misc miscellaneous general uncategorised uncategorized various sonstiges divers otros',
};
const CAT = new Map();
for (const [to, words] of Object.entries(CAT_WORDS)) words.split('|').forEach((part, i) => (i === 0 ? part.split(' ') : [part]).forEach(w => CAT.set(w, to)));
for (const c of CATEGORIES) CAT.set(c.toLowerCase(), c);
const catKey = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&|\+/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const lookup = k => CAT.get(k) || CAT.get(k.replace(/s$/, '')) || CAT.get(k.replace(/es$/, '')) || '';
// → { to, how }: 'vdex' when recognised as one of Vdex's categories, 'own' when it is a category this person already
// uses (their spelling is kept), 'typed' when it is kept as it came, '' when there is nothing.
export function mapCategory(typed, own = []) {
  const t = String(typed == null ? '' : typed).replace(/\s+/g, ' ').trim(); if (isNothing(t)) return { to: '', how: '' };
  const mine = own.find(c => c && c.toLowerCase() === t.toLowerCase()); if (mine) return { to: mine, how: CATEGORIES.includes(mine) ? 'vdex' : 'own' };
  const tryOne = text => { const k = catKey(text); if (!k) return ''; const whole = lookup(k); if (whole) return whole; const parts = k.split(' and ').map(lookup); return parts.length > 1 && parts[0] && parts.every(p => p === parts[0]) ? parts[0] : ''; };
  const steps = t.split(/\s*(?:>|\/|\\|\||:|»|→)\s*/).filter(Boolean); // "Video > Lenses", "Cameras/Bodies"
  const to = tryOne(t) || (steps.length > 1 ? tryOne(steps[steps.length - 1]) || tryOne(steps[0]) : '');
  return to ? { to, how: 'vdex' } : { to: t.slice(0, CAPS.category), how: 'typed' };
}
// The same answer for a list whose categories are to stay as they are written (Vdex's own asset register): only a
// category this person already uses in another spelling changes, to theirs.
function keepCategory(typed, own = []) {
  const t = String(typed == null ? '' : typed).replace(/\s+/g, ' ').trim(); if (isNothing(t)) return { to: '', how: '' };
  const to = own.find(c => c && c.toLowerCase() === t.toLowerCase()) || t.slice(0, CAPS.category);
  return { to, how: CATEGORIES.includes(to) ? 'vdex' : own.includes(to) ? 'own' : 'typed' };
}

/* ------------------------------ what a column holds ------------------------------ */
const SERIAL_LIKE = /^(?=.*\d)[A-Za-z0-9][A-Za-z0-9\-/_.#]{3,29}$/;
const DATE_LIKE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$|^\d{1,2}[\s-][A-Za-z]{3,9}[\s-]\d{2,4}$|^[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}$/;
// numbers: for each value, whether it came out of a number cell of an .xlsx (a row's `nums`). Such a value is the
// number it is; only the typed ones are read by the column's way of writing numbers.
function profile(values, numbers = []) {
  const kept = values.map((x, i) => [String(x == null ? '' : x).trim(), !!numbers[i]]).filter(([x]) => !isNothing(x)), v = kept.map(([x]) => x), n = v.length;
  if (!n) return { n: 0 };
  const style = numberStyle(kept.filter(([, num]) => !num).map(([x]) => x)), nums = kept.map(([x, num]) => (num && x.length <= LONGEST && Number.isFinite(Number(x)) ? Number(x) : parseAmount(x, style)));
  const good = nums.filter(x => typeof x === 'number' && !Number.isNaN(x)), share = k => k / n;
  const dates = v.filter(x => DATE_LIKE.test(x) && parseDate(x) !== null).length;
  const whole = good.filter(Number.isInteger), small = whole.filter(x => x >= 0 && x <= 500);
  let run = 0; for (let i = 1; i < nums.length; i++) if (typeof nums[i] === 'number' && nums[i] === nums[i - 1] + 1) run++;
  const sorted = [...good].sort((a, b) => a - b);
  return {
    n, numeric: share(good.length), money: share(v.filter(hasCurrency).length), dates: share(dates), wholeNumbers: good.length ? whole.length / good.length : 0, small: good.length ? small.length / good.length : 0,
    median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0, sum: good.reduce((a, b) => a + b, 0),
    counting: n >= 3 && run / (n - 1) >= 0.8, // 1, 2, 3 … or 1001, 1002 …: a row number or an asset number
    years: good.length > 0 && good.every(x => Number.isInteger(x) && x >= 1970 && x <= 2040),
    serials: share(v.filter(x => SERIAL_LIKE.test(x) && !DATE_LIKE.test(x) && (!/^\d+$/.test(x) || x.length >= 6)).length),
    unique: new Set(v.map(x => x.toLowerCase())).size / n, length: v.reduce((a, x) => a + x.length, 0) / n,
    cats: share(v.filter(x => mapCategory(x).how === 'vdex').length), words: share(v.filter(x => /[A-Za-z]{2}/.test(x)).length),
  };
}
function fromData(p) {
  if (!p.n) return '';
  if (p.dates >= 0.7) return 'purchased';
  if (p.numeric >= 0.8) {
    if (p.counting || p.years) return '';
    if (!p.money && p.wholeNumbers === 1 && p.unique >= 0.9 && p.median >= 100000) return 'serial'; // long numbers, all different: not prices
    return p.money >= 0.3 || p.wholeNumbers < 0.7 || p.median > 50 ? 'value' : p.small >= 0.9 ? 'qty' : '';
  }
  if (p.cats >= 0.6) return 'category';
  if (p.serials >= 0.6 && p.unique >= 0.8) return 'serial';
  return '';
}

/* ------------------------------ headings and guesses ------------------------------ */
const filled = r => r.cells.filter(c => c !== '').length, isNumber = x => typeof x === 'number' && !Number.isNaN(x);
// Which row holds the headings: the first of the opening rows in which most filled cells are headings Vdex knows.
// Failing that, an opening row of words above columns of numbers or dates. → its place in rows, or -1 for none.
export function findHeader(rows) {
  if (rows[0] && rows[0].made) return 0;
  const top = rows.slice(0, 25);
  for (let i = 0; i < top.length; i++) {
    const cells = top[i].cells.filter(c => c !== ''), exact = cells.filter(c => HEAD.has(headKey(c))).length;
    const known = cells.filter(c => { const k = headingKind(c); return k && !(k.loose && c.split(/\s+/).length > 4); }).length;
    if (!exact || cells.some(c => c.length > 60 || isNumber(parseAmount(c)))) continue; // a row of headings has no numbers in it
    if (known >= 2 && known >= cells.length / 2 || cells.length <= 2 && known === cells.length) return i;
  }
  for (let i = 0; i < Math.min(5, rows.length - 2); i++) {
    const r = rows[i], width = filled(r); if (width < 2) continue;
    const wordy = r.cells.every(c => c === '' || (/[A-Za-z]/.test(c) && !isNumber(parseAmount(c)) && parseDate(c) === null && c.length <= 40));
    if (!wordy) return -1;
    const below = rows.slice(i + 1, i + 60);
    const typed = r.cells.some((c, k) => { if (c === '') return false; const p = profile(below.map(x => x.cells[k])); return p.n >= 2 && (p.numeric >= 0.7 || p.dates >= 0.7); });
    return typed ? i : -1;
  }
  return -1;
}

// → { header, head: [heading per column], body: [rows under it], width, list, titles, above }. header: 'auto' finds
// it, true takes the first row with anything in it, false says there is none. Opening lines above a table (a title,
// an address) are left out: above the headings whatever they hold, and with no headings while they fill one cell only
// (titles counts those, and above holds them as [{ n, text }], so the preview can say which lines they were).
export function layout(rows, header = 'auto') {
  const at = header === 'auto' ? findHeader(rows) : header ? 0 : -1;
  const width = Math.min(60, rows.reduce((w, r) => Math.max(w, r.cells.length), 0));
  let body = rows.slice(at + 1), titles = 0, above = [];
  if (at < 0 && width >= 3) { while (titles < Math.min(body.length - 1, 8) && filled(body[titles]) === 1) titles++; above = body.slice(0, titles).map(r => ({ n: r.n, text: oneLine(r.cells.find(c => c !== '')).slice(0, 80) })); body = body.slice(titles); }
  const head = at >= 0 ? Array.from({ length: width }, (_, i) => rows[at].cells[i] || '') : null;
  return { header: at >= 0, head, body, width, list: at >= 0 && !!rows[at].made, titles, above }; // list: lines of text, under headings Vdex gave them
}

// A guess for every column → ['name', 'category', '', 'serial', …] under TARGETS' names.
export function guessColumns({ head, body, width }) {
  const sample = body.slice(0, 300), col = i => sample.map(r => r.cells[i] ?? '');
  const prof = Array.from({ length: width }, (_, i) => profile(col(i), sample.map(r => !!r.nums && r.nums.includes(i))));
  const kinds = Array.from({ length: width }, (_, i) => (head && head[i] ? headingKind(head[i]) : null));
  const out = new Array(width).fill(''), taken = new Set();
  const cand = kind => kinds.map((k, i) => (k && k.kind === kind ? { i, rank: k.rank } : null)).filter(x => x && prof[x.i].n > 0).sort((a, b) => a.rank - b.rank || a.i - b.i);
  const give = (i, field) => { out[i] = field; if (field && field !== 'notes') taken.add(field); };
  // the name: the surest heading wins, and a "Description" beside an "Item name" is notes. A column of numbers is not
  // the name while another candidate holds words: "Item" as 1, 2, 3 beside "Description" is a line number, left out.
  const counted = c => { const p = prof[c.i]; return !!p.counting || p.numeric >= 0.8 && p.words < 0.2; };
  let names = cand('name');
  if (names.some(counted) && names.some(c => !counted(c) && prof[c.i].words >= 0.5)) names = names.filter(c => !counted(c));
  if (names.length) { give(names[0].i, 'name'); names.slice(1).forEach(c => { if (c.rank > 0 && prof[c.i].length > 0) out[c.i] = 'notes'; }); }
  for (const kind of ['make', 'model', 'category', 'serial', 'qty', 'location', 'purchased', 'warranty', 'serviceEvery', 'firmware', 'lastService']) { const c = cand(kind)[0]; if (c) give(c.i, kind); }
  cand('notes').forEach(c => { out[c.i] = 'notes'; });
  // the value: a replacement value before a plain price before what was paid; of two equally sure, the smaller
  // column is the price of one and the larger the price of the lot (Sortly's Price and Value)
  const values = cand('value');
  if (values.length) { const first = values.filter(c => c.rank === values[0].rank).sort((a, b) => prof[a.i].sum - prof[b.i].sum || a.i - b.i)[0]; give(first.i, 'value'); }
  else { const t = cand('total')[0]; if (t) give(t.i, 'total'); }
  // a folder is a category when what is in it names kinds of kit, otherwise a place
  for (const c of cand('folder')) { const as = prof[c.i].cats >= 0.5 ? 'category' : 'location'; if (!taken.has(as)) give(c.i, as); }
  // columns the headings did not settle, by what is in them
  for (let i = 0; i < width; i++) {
    if (out[i] || kinds[i]) continue;
    const g = fromData(prof[i]); if (g && !taken.has(g) && !(g === 'value' && taken.has('total'))) give(i, g);
  }
  // no name, make or model yet: the column of words with the most different, longest entries
  if (!taken.has('name') && !taken.has('make') && !taken.has('model')) {
    let best = -1, score = 0;
    for (let i = 0; i < width; i++) { if (out[i] || (kinds[i] && kinds[i].kind !== 'name')) continue; const p = prof[i]; if (!p.n || p.words < 0.6) continue; const s = p.unique * Math.min(p.length, 40) * (p.n / (sample.length || 1)); if (s > score) { score = s; best = i; } }
    if (best >= 0) give(best, 'name');
  }
  // what is left with long text is probably notes
  for (let i = 0; i < width; i++) if (!out[i] && !kinds[i] && prof[i].n && prof[i].words >= 0.6 && prof[i].length >= 40 && !prof[i].numeric) out[i] = 'notes';
  return out;
}

/* --------------------------------- rows → items --------------------------------- */
// One line of text: no line breaks, single spaces, and without the apostrophe some programs put in front of text that
// starts like a formula. A formula is only ever text here: nothing is worked out.
const oneLine = s => String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'(?=[=+\-@])/, '');
const manyLines = s => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]+/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().replace(/^'(?=[=+\-@])/, '');
// Make and model go in front of the name unless they are in it already: "Sony" + "FX6" + "A-cam" is "Sony FX6 A-cam".
function joinName(name, make, model) {
  const has = (whole, part) => whole.toLowerCase().includes(part.toLowerCase());
  let out = name;
  if (model && !has(out, model)) out = out ? `${model} ${out}` : model;
  if (make && !has(out, make)) out = `${make} ${out}`.trim();
  return out;
}

// A line that adds the rows up is not an item: "Total" where the name would be, or beside an empty name.
const TOTAL_NAME = /^(?:grand\s+|sub\s*-?\s*)?totals?(?:\s+(?:value|cost|price|replacement\s+value|sum\s+insured))?\s*:?$/i, TOTAL_CELL = /^(?:(?:grand\s+|sub\s*-?\s*|sum\s+)?totals?|summe|gesamt|gesamtsumme|totaal|totale)\b/i;

// Vdex's own asset register (js/backup.js writes it), known by its row of headings. What comes back from it is kept as
// it was written: categories as typed, and an item that happens to be called "Total" is an item.
const REGISTER = ['item', 'category', 'serial number', 'where', 'quantity', 'value each', 'total', 'purchased', 'warranty until', 'firmware', 'last service', 'notes'];
const isRegister = head => !!head && REGISTER.every((k, i) => headKey(head[i]) === k) && head.slice(REGISTER.length).every(x => !x);
// "LENSES" and "Lenses:" are written as headings; "Tripod" is just a word, and so is a word that is always written in
// capitals ("LED", "SSD"): capitals say nothing about those.
const ACRONYMS = new Set(['led', 'leds', 'hmi', 'evf', 'uav', 'uavs', 'uas', 'ssd', 'ssds', 'dslr', 'dslrs']);
const writtenAsHeading = t => /[:：]$/.test(t) || t !== t.toLowerCase() && t === t.toUpperCase() && !ACRONYMS.has(t.toLowerCase());

// The rows under a mapping → what would be added.
//   items     equipment records (GEAR_FIELDS of js/gear-import.js, plus lastService), ready for planGearImport(). An
//             item has a qty only when its row gave one, so updating an owned item from a list that says nothing
//             about quantities leaves the owned quantity alone (a new item without one is added as 1)
//   at        for each item, the row it came from
//   problems  [{ n, text }]: what was left out, left empty or changed, by row
//   left      how many rows were passed over, by reason: { blank, totals, headings, sections, unnamed }
//   passed    [{ n, text, to }]: the lines taken for headings over a group or for titles above the table, by row, with
//             the category a group heading gives the rows under it ('' when none), so a wrong call can be seen
//   lone      { rows, headings, example }: rows holding nothing but a word for a kind of kit in the name column
//             ("Tripod", "Lenses"), how many of them were taken for group headings, and the first one's text
//   categories  [{ from, to, count }] for typed categories that became one of Vdex's; kept: the ones kept as typed
//   currency  the money sign most of the values carry, in their cells or in the column's heading ('' when none)
// own: the categories this person already uses, so "lens filters" joins their "Lens Filters".
// lone: what such a lone word is. 'headings' and 'items' are the person's answer for all of them. 'auto' (the default)
// takes one for a heading only when the list has no Category column and the word is written as a heading ("LENSES",
// "Lenses:") or the list plainly opens with one in ordinary writing (its first row is such a word, or with no row of
// headings the last line above the table is, so headings are not told apart by how they are written); otherwise it
// is an item, because "Tripod" on a row of its own is more
// often a tripod than a heading. A lone cell outside the name column is a heading whatever it says.
export function buildItems({ head, body, width, list, titles = 0, above = [] }, targets, { own = [], lone = 'auto' } = {}) {
  const cols = f => targets.map((t, i) => (t === f ? i : -1)).filter(i => i >= 0 && i < width);
  const C = Object.fromEntries(TARGETS.map(([f]) => [f, cols(f)]));
  const col = i => body.map(r => r.cells[i] ?? '');
  const isNum = (r, i) => !!r.nums && r.nums.includes(i); // a number cell of an .xlsx: a number already, read as one
  const style = new Map([...C.value, ...C.total].map(i => [i, numberStyle(body.filter(r => !isNum(r, i)).map(r => r.cells[i] ?? ''), { heading: head ? head[i] : '' })]));
  const order = new Map([...C.purchased, ...C.warranty, ...C.lastService].map(i => [i, dateOrder(col(i))]));
  const headKeys = head ? head.map(headKey) : null, register = isRegister(head);
  const typeCol = headKeys ? headKeys.indexOf('entry type') : -1; // Sortly lists its folders as rows too
  const noteHead = new Map(C.notes.map(i => { const k = head && head[i] ? headingKind(head[i]) : null; return [i, head && head[i] && !(k && (k.kind === 'notes' || k.kind === 'name')) ? oneLine(head[i]) : '']; }));
  const first = (r, list) => { for (const i of list) { const v = r.cells[i]; if (v != null && v !== '' && !isNothing(v)) return [v, i]; } return ['', -1]; };
  const items = [], at = [], problems = [], left = { blank: 0, totals: 0, headings: titles, sections: 0, unnamed: 0 }, mapped = new Map(), kept = new Map();
  const passed = above.map(x => ({ n: x.n, text: x.text, to: '' })), lonely = { rows: 0, headings: 0, example: '' };
  const mappedCols = targets.map((t, i) => (t ? i : -1)).filter(i => i >= 0), signs = new Map();
  const sign = text => { const m = String(text).match(/[£$€¥₹₩₽₺₪฿]/); if (m) signs.set(m[0], (signs.get(m[0]) || 0) + 1); };
  if (head) [...C.value, ...C.total].forEach(i => { for (let k = 0; k < 3; k++) sign(head[i] || ''); }); // a sign in the heading speaks for the column
  const dense = body.filter(r => filled(r) >= 2).length >= body.length * 0.3; // plenty of rows have more than a name, so a lone word can be a heading
  const nameCols = new Set([...C.name, ...C.make, ...C.model]);
  // The one filled cell of a row, when it sits in the name column and says a kind of kit: the text, else ''.
  const loneWord = r => { if (!dense || width < 3) return ''; const live = r.cells.map((c, i) => (c !== '' ? i : -1)).filter(i => i >= 0); if (live.length !== 1 || !nameCols.has(live[0])) return ''; const t = oneLine(r.cells[live[0]]); return !isNothing(t) && mapCategory(t).how === 'vdex' ? t : ''; };
  // The list plainly opens with a heading that is written like any other word ("Cameras" above the cameras): its other
  // lone words are headings too. When it opens with one written as a heading, only words written that way are. A list
  // with no row of headings has its opening lines taken for titles above the table (layout): the last of them is that
  // opening heading when it says a kind of kit, so "Lenses" further down such a list still heads its rows.
  const lead = !head && dense && width >= 3 && above.length ? oneLine(above[above.length - 1].text) : '';
  const opener = (body[0] && loneWord(body[0])) || (!isNothing(lead) && mapCategory(lead).how === 'vdex' ? lead : ''), opensWithOne = !!opener && !writtenAsHeading(opener);
  const headsGroup = t => lone === 'headings' || lone !== 'items' && !C.category.length && (writtenAsHeading(t) || opensWithOne);
  const pass = (r, text, to) => { if (passed.length < 200) passed.push({ n: r.n, text: oneLine(text).slice(0, 80), to }); };
  let section = '';
  for (const r of body) {
    const say = text => { if (problems.length < 2000) problems.push({ n: r.n, text }); };
    const cells = r.cells, live = cells.map((c, i) => (c !== '' ? i : -1)).filter(i => i >= 0);
    if (!live.length) { left.blank++; continue; }
    if (head && live.every(i => headKey(cells[i]) === headKeys[i]) && live.length >= Math.min(2, width)) { left.headings++; continue; } // the headings again, on a later page
    if (r.heading) { const m = mapCategory(cells[live[0]]); section = m.how === 'vdex' ? m.to : ''; left.sections++; pass(r, cells[live[0]], section); continue; } // "Lenses:" above part of a pasted list
    if (list && r === body[0] && live.length === 1 && HEAD.has(headKey(cells[live[0]])) && HEAD.get(headKey(cells[live[0]])).kind === 'name') { left.headings++; pass(r, cells[live[0]], ''); continue; } // "Equipment" above a pasted list
    const [rawName] = first(r, C.name), [make] = first(r, C.make), [model] = first(r, C.model);
    let name = joinName(oneLine(rawName), oneLine(make), oneLine(model));
    if (typeCol >= 0 && /^folder$/i.test(cells[typeCol] || '')) { left.sections++; pass(r, name || cells[live[0]], ''); continue; }
    // A line that adds the rows up. In Vdex's own register only its own total line is one (no name, or nothing an item
    // has beside the name): an item called "Total" there has a quantity and stays an item.
    const bare = register && [...C.category, ...C.serial, ...C.qty, ...C.location].every(i => isNothing(cells[i]));
    if ((register ? bare : true) && TOTAL_NAME.test(name) || !name && cells.some(c => TOTAL_CELL.test(c.slice(0, 40)))) { left.totals++; continue; }
    // A word on a line of its own in a table of several columns may head the rows under it: "LENSES" gives them their
    // category when they have none. Outside the name column such a line is a heading whatever it says; in the name
    // column it is one only by the rule above (lone), since it may just as well be an item with nothing else filled in.
    if (dense && live.length === 1 && width >= 3) {
      const text = oneLine(cells[live[0]]), m = mapCategory(text), word = !!name && m.how === 'vdex';
      if (word) { lonely.rows++; if (!lonely.example) lonely.example = text.slice(0, 40); }
      if (!name || word && headsGroup(text)) { if (word) lonely.headings++; section = m.how === 'vdex' ? m.to : ''; left.sections++; pass(r, text, section); continue; }
    }
    if (!name) { if (mappedCols.some(i => cells[i] !== '' && !isNothing(cells[i]))) { left.unnamed++; say('no name, so it is left out'); } else left.blank++; continue; }
    const item = { name };
    if (r.cut) say('a cell with more text than Vdex reads is cut short');
    if (name.length > CAPS.name) { item.name = name.slice(0, CAPS.name).trim(); say(`the name is shortened to ${CAPS.name} characters`); }
    // category: Vdex's own where it is recognised, otherwise as typed
    const [cat] = first(r, C.category);
    if (cat) { const m = register ? keepCategory(oneLine(cat), own) : mapCategory(oneLine(cat), own); item.category = m.to; if (m.how === 'vdex' && m.to.toLowerCase() !== oneLine(cat).toLowerCase()) { const k = oneLine(cat).toLowerCase(), e = mapped.get(k) || { from: oneLine(cat), to: m.to, count: 0 }; e.count++; mapped.set(k, e); } else if (m.how === 'typed') kept.set(m.to.toLowerCase(), m.to); }
    else if (section) item.category = section;
    for (const f of ['serial', 'location', 'firmware']) { const [v] = first(r, C[f]); if (!v) continue; const t = oneLine(v); item[f] = t.slice(0, CAPS[f]); if (t.length > CAPS[f]) say(`the ${f === 'location' ? 'place' : f === 'serial' ? 'serial number' : 'firmware version'} is shortened to ${CAPS[f]} characters`); }
    const [q] = first(r, C.qty), qty = parseQty(q); if (q) item.qty = qty.n; if (qty.note) say(qty.note); // no quantity given: none is set
    const money = (list, label) => { const [v, i] = first(r, list); if (!v) return ''; const n = isNum(r, i) && v.length <= LONGEST && Number.isFinite(Number(v)) ? Number(v) : parseAmount(v, style.get(i)); if (Number.isNaN(n) || n < 0 || n > 1e9) { say(`“${oneLine(v).slice(0, 40)}” is not ${label}, so the value is left empty`); return ''; } sign(v); return n; };
    const each = money(C.value, 'a value'), whole = each === '' && C.total.length ? money(C.total, 'a value') : '';
    if (each !== '' && each > 0) item.value = Math.round(each * 100) / 100;
    else if (whole !== '' && whole > 0) item.value = Math.round(whole / qty.n * 100) / 100;
    for (const f of ['purchased', 'warranty', 'lastService']) { const [v, i] = first(r, C[f]); if (!v) continue; const d = parseDate(v, order.get(i)); if (d) item[f] = d; else if (d === null) say(`“${oneLine(v).slice(0, 40)}” is not a date Vdex can read, so the ${f === 'purchased' ? 'purchase date' : f === 'warranty' ? 'warranty date' : 'last service'} is left empty`); }
    { const [v] = first(r, C.serviceEvery); if (v) { const m = parseMonths(v); if (m) item.serviceEvery = Math.min(m, 600); else if (m === null) say(`“${oneLine(v).slice(0, 40)}” is not a number of months, so the service interval is left empty`); } }
    // notes: every column given to Notes; one whose heading says more than "Notes" or "Description" keeps it ("Condition: good")
    const notes = C.notes.map(i => { const t = manyLines(cells[i]); if (!t || isNothing(t)) return ''; return noteHead.get(i) ? `${noteHead.get(i)}: ${t}` : t; }).filter(Boolean).join('\n');
    if (notes) { item.notes = notes.slice(0, CAPS.notes); if (notes.length > CAPS.notes) say(`the notes are shortened to ${CAPS.notes} characters`); }
    items.push(item); at.push(r.n);
  }
  // the same serial number twice in one list: both are added, and the person is told
  const seen = new Map();
  items.forEach((x, i) => { const k = String(x.serial || '').toUpperCase().replace(/[\s-]+/g, ''); if (!k) return; if (seen.has(k)) problems.push({ n: at[i], text: `the serial number ${x.serial} is also on row ${at[seen.get(k)]}: both are added` }); else seen.set(k, i); });
  problems.sort((a, b) => a.n - b.n);
  return { items, at, problems, left, passed: passed.sort((a, b) => a.n - b.n), lone: lonely, categories: [...mapped.values()], kept: [...kept.values()], currency: ([...signs].sort((a, b) => b[1] - a[1])[0] || [''])[0] };
}
