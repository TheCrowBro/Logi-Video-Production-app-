// The role menu: a sheet over the form that asked for it, listing the roles of js/roles.js in fold-down groups, one
// department each. The person's own roles come first, the group holding the current role starts open, a search box
// finds a role by any of its names (a line under it says so: the other names shown under a role are not buttons, and
// searching for one is how it is picked), and a box at the end takes a role that is not in the list. Opened by the form's
// "role" field (js/form.js) on the Crew page and when hiring someone for a booking. Loaded on first use.
import { h, sheet, toast, announce, nodes } from './util.js';
import { ROLE_GROUPS, MY_ROLES, MY_ROLES_ICON, fold, findRole, myRoles, resolveRole, rememberRole, forgetRole, searchRoles } from './roles.js';

export { rememberRole }; // the form keeps a typed role once it is saved

// pickRole({ current, onPick }): onPick gets the role chosen, or '' when it was cleared. Nothing is stored here.
export function pickRole({ current = '', onPick }) {
  if (document.querySelector('.role-menu')) return; // a second tap while the menu was loading
  const opener = document.activeElement;
  const under = opener && opener.closest ? opener.closest('.sheet-back') : null; // the form's own sheet stays out of reach meanwhile
  const now = String(current || '').trim(), listed = findRole(now);
  let close = () => {}, said = 0;
  const choose = role => { close(); onPick(role); };

  const option = (label, sub, on) => h('button', { type: 'button', class: 'role-opt' + (on ? ' on' : ''), 'aria-current': on ? 'true' : null, onclick: () => choose(label) },
    h('span', { class: 'role-text' }, h('span', { class: 'role-name' }, label), sub && h('span', { class: 'role-aka' }, sub)),
    on && h('span', { class: 'role-tick', 'aria-hidden': 'true' }, '✓'));

  /* ------------------------------- the groups ------------------------------- */
  const groups = h('div', { class: 'role-groups' });
  const group = (name, icon, names, rows, open) => {
    const d = h('details', { class: 'twirl role-group', open, 'data-group': name },
      h('summary', null, h('span', { class: 'twirl-ico', 'aria-hidden': 'true' }, icon),
        h('span', null, h('span', { class: 'twirl-name' }, name), h('span', { class: 'twirl-sub' }, names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : ''))),
        h('span', { class: 'pill' }, String(names.length), h('span', { class: 'sr-only' }, names.length === 1 ? ' role' : ' roles'))),
      h('div', { class: 'twirl-body role-list' }, rows));
    // One group open at a time, and the one just opened stays in view when the one above it folds away.
    d.addEventListener('toggle', () => { if (!d.open) return; for (const o of groups.querySelectorAll('details[open]')) if (o !== d) o.open = false; d.scrollIntoView({ block: 'nearest' }); });
    return d;
  };
  const drawGroups = openName => {
    const mine = myRoles();
    groups.replaceChildren(...nodes(
      mine.length > 0 && group(MY_ROLES, MY_ROLES_ICON, mine.map(m => m.name), mine.map(m => h('div', { class: 'role-row' },
        option(m.name, m.used ? 'In use' : '', !listed && fold(m.name) === fold(now)),
        m.kept && !m.used && h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Forget ${m.name}`, title: 'Forget this role', onclick: () => forget(m.name) }, '✕'))), openName === MY_ROLES),
      ROLE_GROUPS.map(g => group(g.name, g.icon, g.roles.map(r => r.name), g.roles.map(r => option(r.name, r.aka.join(', '), !!listed && listed.role === r)), openName === g.name))));
  };
  // Forgetting a role of your own that nobody has: it goes from the list on every device (a change like any other,
  // so it is refused while Vdex is read-only).
  const forget = name => {
    if (!forgetRole(name)) return;
    drawGroups(MY_ROLES); announce(`${name} forgotten`);
    (groups.querySelector(`details[data-group="${MY_ROLES}"] summary`) || groups.querySelector('summary') || search).focus();
  };

  /* -------------------------------- the search -------------------------------- */
  const results = h('div', { class: 'role-results role-list', hidden: true });
  const search = h('input', { type: 'search', class: 'search', placeholder: 'Search roles…', 'aria-label': 'Search roles', autocomplete: 'off', enterKeyHint: 'search' });
  const useTyped = text => { const role = resolveRole(text); if (role) choose(role); };
  const drawResults = () => {
    const typed = search.value.trim(), on = !!fold(typed), turn = ++said;
    groups.hidden = hint.hidden = on; results.hidden = !on;
    const body = menu.closest('.sheet-body'); if (body) body.scrollTop = 0; // a new list starts at its top
    if (!on) { results.replaceChildren(); return; }
    const { hits, more } = searchRoles(typed);
    results.replaceChildren(...nodes(
      hits.map(x => option(x.label, x.same ? `Same as ${x.same} · ${x.group}` : [x.group, x.aka.join(', ')].filter(Boolean).join(' · '), fold(x.label) === fold(now))),
      more && h('p', { class: 'muted small' }, 'More roles match: keep typing to narrow them down.'),
      !hits.length && h('p', { class: 'muted small' }, `No role like “${typed}” in the list.`),
      !hits.length && h('button', { type: 'button', class: 'btn ghost', onclick: () => useTyped(typed) }, `Use “${resolveRole(typed)}” as the role`)));
    // Said once typing has paused, not at every letter (as the search across everything does).
    setTimeout(() => { if (turn === said && menu.isConnected) announce(hits.length ? `${hits.length}${more ? ' or more' : ''} role${hits.length === 1 ? '' : 's'} found` : 'No role found'); }, 500);
  };
  search.addEventListener('input', drawResults);
  // Enter takes the first role found, or what was typed when nothing matches. Escape empties the box first, and
  // closes the menu only when the box is already empty.
  search.addEventListener('keydown', e => {
    if (e.key === 'Escape' && search.value) { e.preventDefault(); e.stopPropagation(); search.value = ''; drawResults(); }
    if (e.key !== 'Enter') return;
    e.preventDefault(); const first = results.querySelector('.role-opt'); if (first) first.click(); else useTyped(search.value);
  });

  /* ---------------------------- a role of your own ---------------------------- */
  const own = h('input', { type: 'text', id: 'role-own', maxLength: 60, placeholder: 'e.g. Jib assistant', autocomplete: 'off', autocapitalize: 'words', enterKeyHint: 'done' });
  const useOwn = () => { if (!resolveRole(own.value)) { toast('Type the role first'); own.focus(); return; } useTyped(own.value); };
  own.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); useOwn(); } });

  const hint = h('p', { class: 'muted small role-hint' }, 'Prefer another name, such as DP or Sound Mixer? Search for it and pick it.');
  const menu = h('div', { class: 'role-menu' },
    h('div', { class: 'role-head' }, search,
      now && h('div', { class: 'role-now' }, h('span', null, 'Chosen: ', h('strong', null, now)), h('button', { type: 'button', class: 'btn ghost small', onclick: () => choose('') }, 'Clear the role'))),
    hint, groups, results,
    h('div', { class: 'field role-own' }, h('label', { for: 'role-own' }, 'Not in the list? Type another role'),
      h('div', { class: 'row-edit' }, own, h('button', { type: 'button', class: 'btn ghost', onclick: useOwn }, 'Use this role')),
      h('small', { class: 'muted' }, 'It is kept under My roles for next time, once the form is saved.')));

  // Up and Down walk the menu (the search box, the groups, the roles of the open group, the box at the end); a letter
  // typed anywhere else goes to the search box.
  const reach = () => [...menu.querySelectorAll('input, summary, button')].filter(el => { const d = el.closest('details'); return !el.closest('[hidden]') && (!d || d.open || el.tagName === 'SUMMARY'); });
  menu.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = reach(), at = items.indexOf(document.activeElement); if (at < 0) return;
      const to = items[at + (e.key === 'ArrowDown' ? 1 : -1)]; if (to) { e.preventDefault(); to.focus(); }
    } else if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) search.focus();
  });

  drawGroups(!now ? '' : listed ? listed.group : MY_ROLES);
  if (under) under.inert = true;
  ({ close } = sheet('Choose a role', menu, { onClose: () => { if (under) under.inert = false; if (opener && opener.isConnected) opener.focus(); } }));
  // The current role is shown, or the first group; the search box is not focused by itself, so a phone's keyboard
  // does not cover the list before it is wanted.
  setTimeout(() => { const el = groups.querySelector('.role-opt.on') || groups.querySelector('summary'); if (el && !menu.contains(document.activeElement)) el.focus(); }, 40);
}
