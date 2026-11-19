// The one-time word to people whose PIN was chosen while PINs stopped at 8 digits. After their next unlock a full screen
// says a PIN can now be 4 to 20 digits long, and offers to set a new one or keep the one they have. Either answer is
// final for this device: the lock config remembers it (offerLongerPin in js/lock.js, which fetches this module only
// when the offer is due). A new PIN goes through setPin(), the same re-wrap of the same data key as Change PIN… in
// Settings, so the vault, fingerprint or face unlock, the wrong-PIN count and the erase switch are all left as they are.
// Someone who unlocked with a fingerprint or face types the current PIN first, exactly as Change PIN… asks.
import { h, nodes, toast, announce } from './util.js';
import { PIN_MIN, PIN_MAX, PIN_RULE, pinField, pinProblem, checkPin, setPin, setOption, config, coverAll } from './lock.js';
import { refreshTour } from './tour.js';

// Shows the offer. done resolves when the screen has gone; drop() takes it away with no answer recorded (the lock
// screen is coming up over it), so it is offered again after the next unlock.
export function show({ knowsPin }) {
  let finish, view = '', busy = false, over = false;
  const done = new Promise(res => { finish = res; });
  const card = h('form', { class: 'lock-card stack', noValidate: true });
  const screen = h('div', { class: 'lock lock-setup pin-offer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pin-offer-title', 'aria-describedby': 'pin-offer-text' }, card);
  const brand = () => h('div', { class: 'brand' }, h('span', { class: 'dot' }), 'VDEX');
  // dropped: the lock screen is coming up over the offer, so nothing is shown again underneath it.
  const end = dropped => {
    if (over) return; over = true;
    document.removeEventListener('keydown', keys);
    screen.remove(); uncover();
    const main = document.getElementById('page'); main && main.focus({ preventScroll: true }); // as the lock screen does on its way out
    if (dropped !== true) refreshTour(); // a walkthrough step that was showing the menu or the search shows it again, as after an unlock
    finish();
  };
  const keep = () => { if (busy) return; setOption({ max: PIN_MAX }); end(); announce('Your PIN stays as it is'); };

  const choice = () => {
    view = 'choice';
    const set = h('button', { class: 'btn primary', type: 'button', onclick: () => form() }, 'Set a new PIN');
    card.replaceChildren(
      brand(),
      h('h1', { id: 'pin-offer-title' }, 'Your PIN can be longer now'),
      h('p', { class: 'small', id: 'pin-offer-text' }, `PINs used to stop at 8 digits. A PIN can now be ${PIN_MIN} to ${PIN_MAX} digits long. You can set a new one, or keep the one you have, which works exactly as before.`),
      h('p', { class: 'small muted' }, 'Vdex asks this once. Change PIN… under Settings → Security sets a new one at any time.'),
      set,
      h('button', { class: 'btn ghost', type: 'button', onclick: keep }, 'Keep my current PIN'));
    set.focus();
  };

  let cur = null, a = null, b = null, err = null, save = null;
  const form = () => {
    view = 'form';
    cur = knowsPin ? null : pinField('Current PIN', 'next'); a = pinField('New PIN', 'next'); b = pinField('Repeat the PIN', 'done');
    err = h('div', { class: 'lock-msg', role: 'alert' });
    save = h('button', { class: 'btn primary', type: 'submit' }, 'Save the new PIN');
    card.replaceChildren(...nodes(
      brand(),
      h('h1', { id: 'pin-offer-title' }, 'Set a new PIN'),
      h('p', { class: 'small muted', id: 'pin-offer-text' }, PIN_RULE + ((config() || {}).bio ? ' Fingerprint or face unlock carries on working.' : '')),
      cur, a, b, err,
      h('p', { class: 'warn small' }, 'A forgotten PIN cannot be recovered. The way back is to erase this device and restore from your cloud storage or a backup, so keep one of those current.'),
      save,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { if (!busy) choice(); } }, 'Back')));
    (cur || a).focus();
  };
  card.addEventListener('submit', async e => {
    e.preventDefault();
    if (view !== 'form' || busy) return;
    const say = (problem, field) => { err.textContent = problem; field.focus(); };
    // Go on a field moves on to the next one still empty, as on the set-up screen
    if (cur && cur.value !== '' && a.value === '') { err.textContent = ''; a.focus(); return; }
    if (!pinProblem(a.value) && b.value === '') { err.textContent = ''; b.focus(); return; }
    const problem = pinProblem(a.value, b.value);
    if (problem) return say(problem, problem.startsWith('The two') ? b : a);
    // The PIN that is saved is the one just checked and repeated, as it stood at this moment: deriving a key takes a
    // while (longer on a phone), and the fields are not read again after it. They also stay as they are meanwhile.
    const pin = a.value, current = cur ? cur.value : null, fields = [cur, a, b].filter(Boolean);
    const hold = on => { busy = on; save.disabled = on; fields.forEach(f => { f.readOnly = on; }); };
    hold(true); save.textContent = 'Saving…'; err.textContent = '';
    const failed = (problem2, field) => { hold(false); save.textContent = 'Save the new PIN'; say(problem2, field); };
    try {
      if (cur && !(await checkPin(current))) return failed('That is not your current PIN.', cur);
      await setPin(pin);
    } catch (e2) { return failed('Could not set the PIN: ' + (e2.message || e2), a); }
    busy = false;
    toast('PIN changed');
    end();
  });
  // Escape steps back: from the new PIN to the choice, and from the choice it is the same as keeping the PIN.
  const keys = e => { if (e.key !== 'Escape' || busy) return; e.preventDefault(); if (view === 'form') choice(); else keep(); };

  // The offer can arrive late (its file is fetched after the unlock), over a menu or a search opened meanwhile. They
  // close first, as under the lock screen: left open underneath, their own key handlers would take the Escape meant
  // for this screen and give the page behind it back to the keyboard.
  window.logiMenu?.close(); window.logiSearch?.close();
  document.addEventListener('keydown', keys);
  document.body.append(screen);
  const uncover = coverAll(screen);
  choice();
  return { done, drop: () => end(true) };
}
