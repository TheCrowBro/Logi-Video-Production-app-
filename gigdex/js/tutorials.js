// Page tutorials: the ? button runs a short spotlight walkthrough of whatever is on screen. Every page module carries
// its own steps (page.tutorial: an array, or a function returning one for the view it is showing), and a sheet can
// register steps under its title (sheetTutorial in js/tour.js), so no central list has to know every page.
// A step is { title, text, target: ['.css-selector', …] } (the first selector on screen is highlighted; a step with a
// target that is not on screen is skipped). A step with target null is a plain card.
import { h, sheet, toast } from './util.js';
import { runTour, startTour, sheetSteps } from './tour.js';

const pages = () => (window.gigdexPages ? window.gigdexPages() : []); // [{ id, label, icon, page? }] from app.js
const topSheet = () => { const all = document.querySelectorAll('.sheet[aria-label]'); return all[all.length - 1] || null; };
const resolve = steps => (typeof steps === 'function' ? steps() : steps) || [];

export function openTutorial() {
  const top = topSheet();
  if (top) {
    const title = top.getAttribute('aria-label');
    const steps = resolve(sheetSteps(title));
    if (steps.length) return runTour(steps, { root: topSheet });
    return toast('No walkthrough for this panel yet. Close it and tap ? on the page.');
  }
  const id = window.logiPage && window.logiPage();
  const tab = pages().find(t => t.id === id);
  const steps = tab && tab.page ? resolve(tab.page.tutorial) : [];
  if (!steps.length) return openChooser();
  runTour(steps, { footer: (n, stop) => n === 0 && h('button', { class: 'btn ghost small', type: 'button', onclick: () => { stop(); openChooser(); } }, 'Other pages…') });
}

export function openChooser() {
  let close = () => {};
  const body = h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, 'A short walkthrough of any page. Each one highlights the boxes on that page with a line about what they do.'),
    h('div', { class: 'list' }, ...pages().map(t => h('button', { class: 'card tap', type: 'button', onclick: async () => {
      close();
      await window.logiGo?.(t.id);
      await new Promise(r => setTimeout(r, 500));
      const tab = pages().find(x => x.id === t.id);
      const steps = tab && tab.page ? resolve(tab.page.tutorial) : [];
      if (steps.length) runTour(steps); else toast('Nothing to show on this page yet');
    } }, h('strong', null, `${t.icon} ${t.label}`)))),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', type: 'button', onclick: () => { close(); setTimeout(() => startTour(), 150); } }, '🧭 The welcome tour')));
  ({ close } = sheet('Tutorials', body));
}
