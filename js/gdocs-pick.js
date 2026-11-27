// A Google Doc straight from the person's Google Drive, for TC Notes and the teleprompter: Google's own file picker,
// where they choose the Doc (which gives Vdex that one file, under the drive.file permission it already asks for the
// calendar feed), then Drive's export of it as a Word file, read like any other (js/docx.js keeps its emphasis and a
// VIDEO | AUDIO table). Offered on the website and in the Android app once Vdex's Google project has a key for the
// picker (googlePickerKey in js/cloud-config.js; docs/turn-on-sign-in.md says how); not in the desktop or iPhone app,
// whose sign-ins happen outside the page the picker opens in. Loaded on first use.
import { CLOUD_APPS } from './cloud-config.js';
import { googleToken } from './providers.js';
import { isApp } from './native.js';

const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const googleDocsReady = () => !!(CLOUD_APPS.google && CLOUD_APPS.googlePickerKey) && !window.vdexDesktop && !isApp;
// The Google project's number, which its client ID starts with: the picker grants the chosen file to that project.
const projectNumber = () => String(CLOUD_APPS.google || '').split('-')[0];
let api = null;
const loadPicker = () => api || (api = new Promise((res, rej) => {
  const fail = () => { api = null; rej(new Error('Google’s file picker could not be loaded. Check the connection and try again.')); };
  const go = () => window.gapi.load('picker', { callback: res, onerror: fail, timeout: 15000, ontimeout: fail });
  if (window.gapi && window.gapi.load) { go(); return; }
  const s = document.createElement('script'); s.src = 'https://apis.google.com/js/api.js'; s.onload = go; s.onerror = fail; document.head.append(s);
}));
// The chosen Doc as a Word file, or null when the person closes the picker.
export async function pickGoogleDoc() {
  const token = await googleToken(DRIVE_FILE, true);
  await loadPicker();
  const G = window.google.picker;
  const picked = await new Promise(res => {
    const view = new G.DocsView(G.ViewId.DOCUMENTS).setMimeTypes('application/vnd.google-apps.document').setMode(G.DocsViewMode.LIST);
    new G.PickerBuilder().addView(view).setOAuthToken(token).setDeveloperKey(CLOUD_APPS.googlePickerKey).setAppId(projectNumber()).setTitle('Choose the script')
      .setCallback(d => { const a = d[G.Response.ACTION]; if (a === G.Action.PICKED) res(d[G.Response.DOCUMENTS][0]); else if (a === G.Action.CANCEL) res(null); })
      .build().setVisible(true);
  });
  if (!picked) return null;
  const id = picked[G.Document.ID], name = String(picked[G.Document.NAME] || 'Google Doc');
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(DOCX)}`, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error(r.status === 403 || r.status === 404 ? 'Google did not let Vdex read that Doc. Choose it again in the picker.' : `Google Drive could not send that Doc (${r.status}). Try again.`);
  return new File([await r.blob()], name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() + '.docx', { type: DOCX });
}
