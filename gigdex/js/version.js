export const VERSION = '0.1.0';
export const BUILD = 'dev'; // stamped with the commit on deploy (tools/stamp-build.mjs)
export const BUILT = '';    // stamped with the deploy date
// Where the web app and its share pages (invoice.html, daysheet.html) live once published. Until then, links are built
// from the address the app is opened at (see shareBase below), so they work wherever Gigdex is served.
export const SITE = '';
export const shareBase = () => (SITE || (location.protocol.startsWith('http') ? new URL('./', location.href).href : ''));
