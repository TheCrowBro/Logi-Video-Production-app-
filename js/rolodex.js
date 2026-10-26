// 3D rotating drum of tabs. Next tab sits below, previous above; cycling rolls the drum.
import { h, announce } from './util.js';
import { haptic } from './a11y.js';

const ITEM_H = 54;

export function createRolodex(root, tabs, { onSelect, start = 0 }) {
  const n = tabs.length;
  const step = 360 / n;
  const radius = Math.round(ITEM_H / 2 / Math.tan(Math.PI / n));
  let index = start;
  let rot = start; // cumulative, so the drum never spins backwards the long way round

  const ring = h('div', { class: 'ring' });
  const items = tabs.map((t, i) => {
    const el = h('button', {
      class: 'tab', type: 'button', role: 'tab', 'aria-label': `${t.label}, section ${i + 1} of ${n}`,
      style: `transform: rotateX(${-i * step}deg) translateZ(${radius}px)`,
      onclick: () => go(i),
    }, h('span', { class: 'tab-ico', 'aria-hidden': 'true' }, t.icon), h('span', { class: 'tab-name' }, t.label), h('span', { class: 'tab-no' }, String(i + 1).padStart(2, '0')));
    ring.append(el);
    return el;
  });

  const up = h('button', { class: 'drum-btn up', type: 'button', 'aria-label': 'Previous section', title: 'Previous section', onclick: () => go(index - 1) }, '▲');
  const down = h('button', { class: 'drum-btn down', type: 'button', 'aria-label': 'Next section', title: 'Next section', onclick: () => go(index + 1) }, '▼');
  const drum = h('div', { class: 'drum', role: 'tablist', 'aria-label': 'Sections' }, ring);
  root.append(h('div', { class: 'binder' }, drum, up, down));

  function paint() {
    ring.style.transform = `translateZ(${-radius}px) rotateX(${rot * step}deg)`;
    items.forEach((el, i) => {
      let d = Math.abs(((i - index) % n + n) % n);
      d = Math.min(d, n - d);
      el.dataset.d = d;
      el.setAttribute('aria-selected', d === 0 ? 'true' : 'false');
      el.tabIndex = d === 0 ? 0 : -1;
    });
  }

  function go(to, silent) {
    to = ((to % n) + n) % n;
    if (to === index && !silent) return;
    let delta = ((to - index) % n + n) % n;
    if (delta > n / 2) delta -= n;
    rot += delta;
    const dir = delta >= 0 ? 1 : -1;
    index = to;
    paint();
    if (!silent) { haptic(); announce(tabs[index].label); onSelect(index, dir); }
  }

  // Drag / swipe on the drum cycles tabs.
  let sx, sy, moved;
  drum.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; moved = false; });
  drum.addEventListener('pointermove', e => {
    if (sx == null || moved) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dy) > 26 && Math.abs(dy) > Math.abs(dx)) { moved = true; go(index + (dy < 0 ? 1 : -1)); }
    else if (Math.abs(dx) > 40) { moved = true; go(index + (dx < 0 ? 1 : -1)); }
  });
  const end = () => { sx = null; };
  drum.addEventListener('pointerup', end);
  drum.addEventListener('pointercancel', end);
  drum.addEventListener('wheel', e => { e.preventDefault(); if (!drum._lock) { drum._lock = true; go(index + (e.deltaY > 0 ? 1 : -1)); setTimeout(() => drum._lock = false, 380); } }, { passive: false });

  document.addEventListener('keydown', e => {
    if (/input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable) return;
    if (document.querySelector('.sheet-back')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(index + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(index - 1);
  });

  paint();
  return { go, get index() { return index; } };
}
