/* =====================================================================
   GRIDIFY — app.js
    1 Constants & parser      2 Helpers & state       3 Dropdown component
    4 Persistence (localStorage)                      5 Control panel
    6 Engine (slots, filters, conflicts, load)        7 Timetable rendering
    8 View controls (days, time window, instructor, compact, theme, A/B tabs)
    9 Exports (PDF, PNG, .ics) & share link          10 Free Slot Finder
   11 Events & start-up
   Uses COURSES, NOTES, LOCS, GROUPS, RAW_PARTS (data files), html2pdf + html2canvas (CDN).
   ===================================================================== */

/* ---------- 1) CONSTANTS & PARSER ---------- */
const DAYS = ['Sat','Sun','Mon','Tue','Wed','Thu'];
const FULL = {Sat:'Saturday',Sun:'Sunday',Mon:'Monday',Tue:'Tuesday',Wed:'Wednesday',Thu:'Thursday'};
const TYPE = {L:'Lecture',B:'Lab',T:'Tutorial'};
const THEMES = ['dark','light','mono','vivid'];
const ALL_LEVELS = ['1','2','3','4'];                       // every level gets a "no group / no specialization" option
const isGroupLevel = lv => +lv < 3;                          // Levels 1-2 have groups, 3-4 have specializations
const allNote = lv => isGroupLevel(lv)
  ? 'Every group\u2019s slots for these courses are shown, each tagged with its group. Section numbers are unique to a group, so typing yours narrows everything to your group.'
  : 'Shared courses are offered to several specializations. Every specialization\u2019s slots are shown, each tagged with the specializations it serves \u2014 pin the ones that are yours. Section numbers repeat across specializations.';

const DATA = {};
(function parse() {
  let k = null;
  RAW_PARTS.join('\n').split('\n').forEach(line => {
    line = line.trim();
    if (!line) return;
    if (line[0] === '#') { k = line.slice(1).trim(); DATA[k] = DATA[k] || []; return; }
    if (!k) return;
    const p = line.split('|').map(s => s.trim());
    if (p.length < 8) return;
    DATA[k].push({c:p[0], t:p[1], d:DAYS.indexOf(p[2]), s:+p[3], n:+p[4], x:p[5], loc:p[6], ins:p[7], specs:[k.split('-')[1]]});
  });
})();

/* "<level>-ALL" pseudo-group: every course offered by 2+ groups / specializations of that level.
   Identical slots are merged and remember which groups they serve. */
const COMMON = {};
ALL_LEVELS.forEach(lv => {
  const groups = GROUPS[lv].filter(g => DATA[lv + '-' + g]);
  const offered = {};
  groups.forEach(g => DATA[lv + '-' + g].forEach(r => (offered[r.c] = offered[r.c] || new Set()).add(g)));
  const merged = new Map();
  groups.forEach(g => DATA[lv + '-' + g].forEach(r => {
    if (offered[r.c].size < 2) return;
    const id = [r.c, r.t, r.d, r.s, r.n, r.x, r.loc, r.ins].join('|');
    if (!merged.has(id)) merged.set(id, {...r, specs: []});
    merged.get(id).specs.push(g);
  }));
  DATA[lv + '-ALL'] = [...merged.values()];
  COMMON[lv + '-ALL'] = {};
  Object.keys(offered).filter(c => offered[c].size > 1).forEach(c => COMMON[lv + '-ALL'][c] = [...offered[c]]);
});

/* ---------- 2) HELPERS & STATE ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ARABIC = /[\u0600-\u06FF]/;
const bd = s => ARABIC.test(s) ? `<bdi class="ar" dir="rtl">${esc(s)}</bdi>` : `<bdi>${esc(s)}</bdi>`;
const isMobile = () => window.matchMedia('(max-width: 720px)').matches;

const cinfo    = c => COURSES[c] || [c, c];                      // [full name, abbreviation]
const cfull    = c => `${cinfo(c)[0]} (${cinfo(c)[1]})`;         // "Database Management Systems (DBMS)"
const cIdx     = c => Math.max(0, Object.keys(COURSES).indexOf(c)) % 10;      // colour index for the Vibrant theme
const lpair    = k => LOCS[k] || ['', k];
const locCard  = k => { const [a, e] = lpair(k); return bd(a || e); };
const locText  = k => { const [a, e] = lpair(k); return a ? `${a} · ${e}` : e; };
const keyLabel = k => { const [lv, g] = k.split('-'); return g === 'ALL' ? `L${lv} · ${isGroupLevel(lv) ? 'All groups' : 'Common'}` : `L${lv} · ${g}`; };
const tagOf    = s => s.all ? `L${s.g.split('-')[0]} · ${s.specs.join(' + ')}` : keyLabel(s.g);
const hh       = h => `${h % 12 || 12} ${h >= 12 && h < 24 ? 'PM' : 'AM'}`;     // 8 -> "8 AM", 14 -> "2 PM"
const label    = s => `${cfull(s.c)} ${TYPE[s.t].toLowerCase()}`;
const tok      = id => id.split('|').slice(0, 6).join('~');                     // short slot token (used in share links)
const insNames = str => String(str).split(/\s+-\s+|,\s*/).map(x => x.trim()).filter(Boolean);
const warnIcon = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 2 17h16L10 3Zm0 5v4m0 2.5v.01"/></svg>';
const CHECKSVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 10.5 3.5 3.5 7.5-8"/></svg>';

/* Time rules: even hours only, 8 AM (8) to 8 PM (20) */
const evenIn = (v, d) => { v = +v; return Number.isInteger(v) && v % 2 === 0 && v >= 8 && v <= 20 ? v : d; };
const cleanRange = (f, t) => { f = evenIn(f, 8); t = evenIn(t, 20); return f < t ? [f, t] : [8, 20]; };
const hourOpts = (a, b) => { const o = []; for (let h = a; h <= b; h += 2) o.push({value: String(h), label: hh(h)}); return o; };
const FROM_OPTS = hourOpts(8, 18), TO_OPTS = hourOpts(10, 20);

/* Two independent schedules (Compare mode). S always points at the active one. */
const mkSch = () => ({entries: [], sel: new Set(), auto: new Set()});   // entries, pinned ids, ids already auto-pinned once
const sch = {A: mkSch(), B: mkSch()};
let cur = 'A', S = sch.A;
const F = {from: 8, to: 20, ins: '', compact: false};          // view filters (shared by both schedules)
let theme = 'dark';
const activeDays = new Set([0, 1, 2, 3, 4, 5]);                 // days the user keeps visible
let slots = [];             // every available slot for the active schedule's courses
let buildWarns = [];        // warnings produced while collecting slots

let flashTimer, toastTimer;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function flash(msg, isErr) {
  const f = $('flash');
  f.textContent = msg;
  f.classList.toggle('err', !!isErr);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { f.textContent = ''; }, 4500);
  toast(msg, isErr);
}

/* ---------- 3) CUSTOM DROPDOWN ----------
   Dropdown(rootEl, labelId, onChange) -> { value, setOptions(list, selectedValue), set(value), close() }
   Keys: Up Down Home End Enter Space Esc Tab + type-ahead. The menu lives in <body>, so it is never clipped. */
const CHEV  = '<svg class="dd-chev" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 5 5 5-5"/></svg>';
const CHECK = '<svg class="ck" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 10.5 3.5 3.5 7.5-8"/></svg>';

function Dropdown(root, labelId, onChange) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dd-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-labelledby', labelId);
  btn.innerHTML = '<span class="dd-val"></span>' + CHEV;

  const menu = document.createElement('ul');
  menu.className = 'dd-menu';
  menu.setAttribute('role', 'listbox');
  root.appendChild(btn);
  document.body.appendChild(menu);

  let opts = [], sel = 0, hl = 0, isOpen = false, typed = '', typedTimer, lastW = window.innerWidth;
  const api = { get value() { return opts[sel] ? opts[sel].value : ''; }, setOptions, set, close };

  function paintValue() {
    const o = opts[sel];
    btn.querySelector('.dd-val').textContent = o ? o.label + (o.hint ? '  ·  ' + o.hint : '') : '';
  }
  function paintMenu() {
    menu.innerHTML = opts.map((o, i) =>
      `<li role="option" data-i="${i}" aria-selected="${i === sel}" class="${i === hl ? 'hl' : ''}">
         <span class="dd-t">${esc(o.label)}</span>${o.hint ? `<span class="dd-hint">${esc(o.hint)}</span>` : ''}${CHECK}</li>`).join('');
  }
  function reveal(i) {                       // scroll only the menu itself (never the page)
    const li = menu.children[i];
    if (!li) return;
    if (li.offsetTop < menu.scrollTop) menu.scrollTop = li.offsetTop - 8;
    else if (li.offsetTop + li.offsetHeight > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = li.offsetTop + li.offsetHeight - menu.clientHeight + 8;
  }
  function setOptions(list, value) {
    opts = list;
    sel = Math.max(0, list.findIndex(o => o.value === value));
    hl = sel;
    paintValue(); paintMenu();
  }
  function set(value) {                      // change the selection without firing onChange
    const i = opts.findIndex(o => o.value === value);
    if (i >= 0) { sel = hl = i; paintValue(); paintMenu(); }
  }
  function place() {
    const r = btn.getBoundingClientRect();
    const mh = Math.min(menu.scrollHeight, 300);
    menu.style.width = r.width + 'px';
    menu.style.left = r.left + 'px';
    if (window.innerHeight - r.bottom < mh + 20 && r.top > window.innerHeight - r.bottom) {
      menu.style.top = (r.top - mh - 8) + 'px'; menu.style.transformOrigin = 'bottom';
    } else {
      menu.style.top = (r.bottom + 8) + 'px'; menu.style.transformOrigin = 'top';
    }
  }
  function open() {
    if (!opts.length) return;
    hl = sel; paintMenu(); place();
    isOpen = true;
    menu.classList.add('open'); root.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    reveal(hl);
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    menu.classList.remove('open'); root.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  }
  function choose(i) {
    const changed = i !== sel;
    sel = hl = i;
    paintValue(); paintMenu(); close();
    if (changed) onChange(api.value);
  }
  function move(to) {
    hl = (to + opts.length) % opts.length;
    [...menu.children].forEach((li, i) => li.classList.toggle('hl', i === hl));
    reveal(hl);
  }

  btn.addEventListener('click', () => isOpen ? close() : open());
  btn.addEventListener('keydown', e => {
    const k = e.key;
    if (k === 'Tab') return close();
    if (k === 'Escape') { if (isOpen) { e.preventDefault(); e.stopPropagation(); close(); } return; }
    if (['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(k)) e.preventDefault();
    if (!isOpen) { if (['ArrowDown','ArrowUp','Enter',' '].includes(k)) open(); return; }
    if (k === 'ArrowDown') move(hl + 1);
    else if (k === 'ArrowUp') move(hl - 1);
    else if (k === 'Home') move(0);
    else if (k === 'End') move(opts.length - 1);
    else if (k === 'Enter' || k === ' ') choose(hl);
    else if (k.length === 1) {               // type-ahead
      typed += k.toLowerCase(); clearTimeout(typedTimer); typedTimer = setTimeout(() => typed = '', 600);
      const m = opts.findIndex(o => o.label.toLowerCase().startsWith(typed));
      if (m >= 0) move(m);
    }
  });
  menu.addEventListener('mousedown', e => e.preventDefault());
  menu.addEventListener('click', e => { const li = e.target.closest('li'); if (li) choose(+li.dataset.i); });
  document.addEventListener('mousedown', e => { if (isOpen && !menu.contains(e.target) && !btn.contains(e.target)) close(); });
  window.addEventListener('resize', () => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; close(); } });   // mobile URL-bar resizes must not close it
  window.addEventListener('scroll', e => { if (isOpen && !menu.contains(e.target)) close(); }, true);

  return api;
}

/* ---------- 4) PERSISTENCE (localStorage) ---------- */
const LS_KEY = 'gridify.v1';
const ser = s => ({e: s.entries, s: [...s.sel], a: [...s.auto]});
function des(s, o) {
  const ok = e => e && typeof e.key === 'string' && DATA[e.key] && Array.isArray(e.courses) && e.courses.length;
  s.entries = (Array.isArray(o.e) ? o.e : []).filter(ok).map(e => ({key: e.key, sec: String(e.sec || ''), courses: e.courses.map(String)}));
  s.sel = new Set(Array.isArray(o.s) ? o.s : []);
  s.auto = new Set(Array.isArray(o.a) ? o.a : []);
}
function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      v: 1, level: levelDD.value, group: groupDD.value, theme, days: dayList(),
      from: F.from, to: F.to, ins: F.ins, compact: F.compact, cur, A: ser(sch.A), B: ser(sch.B)
    }));
  } catch (e) { /* private mode / quota: the app still works, it just will not remember */ }
}
function loadSaved() {
  try { const o = JSON.parse(localStorage.getItem(LS_KEY)); return o && o.v === 1 ? o : null; } catch (e) { return null; }
}

/* Settings come either from localStorage or from a share link (?level=…&courses=…&theme=…&time=8-16) */
function readURL() {
  const p = new URLSearchParams(window.location.search);
  if (!p.has('courses')) return null;
  const entries = p.get('courses').split(';').map(t => {
    const [key, sec = '', cs = ''] = t.split(':');
    return {key, sec, courses: cs.split('+').filter(Boolean)};
  }).filter(e => DATA[e.key] && e.courses.length);
  if (!entries.length) return null;
  return {level: p.get('level'), group: p.get('group'), theme: p.get('theme'), time: p.get('time'), days: p.get('days'),
          ins: p.get('ins') || '', compact: p.get('compact') === '1', entries, pins: (p.get('pins') || '').split(';').filter(Boolean)};
}

function applySettings(o, fromUrl) {
  if (THEMES.includes(o.theme)) theme = o.theme;
  let d = fromUrl ? String(o.days || '').split('').map(Number) : o.days;
  d = Array.isArray(d) ? d.filter(i => Number.isInteger(i) && i >= 0 && i <= 5) : [];
  activeDays.clear();
  (d.length ? d : [0, 1, 2, 3, 4, 5]).forEach(i => activeDays.add(i));
  let f = o.from, t = o.to;
  if (fromUrl && o.time) [f, t] = String(o.time).split('-');
  [F.from, F.to] = cleanRange(f, t);
  F.ins = typeof o.ins === 'string' ? o.ins : '';
  F.compact = !!o.compact;
  levelDD.setOptions(levelOpts, ALL_LEVELS.includes(String(o.level)) ? String(o.level) : '4');
  fillGroups(o.group || 'ALL');
  if (fromUrl) {
    sch.A = mkSch(); sch.B = mkSch();
    sch.A.entries = o.entries;
    sch.A.pins = new Set(o.pins);                   // pins from the link, matched to slots once they are built
    cur = 'A';
  } else {
    des(sch.A, o.A || {}); des(sch.B, o.B || {});
    cur = o.cur === 'B' ? 'B' : 'A';
  }
  S = sch[cur];
}

/* ---------- 5) CONTROL PANEL ---------- */
const levelOpts = ALL_LEVELS.map(n => ({value: n, label: 'Level ' + n}));
const levelDD = Dropdown($('ddLevel'), 'lblLevel', () => { fillGroups(); save(); });
const groupDD = Dropdown($('ddGroup'), 'lblGroup', () => { fillCourses(); save(); });
const gkey = () => levelDD.value + '-' + groupDD.value;

function fillGroups(keep) {
  const lv = levelDD.value;
  if (keep === undefined) keep = groupDD.value;
  const opts = GROUPS[lv].map(g => ({value: g, label: g, hint: DATA[lv + '-' + g] ? '' : 'no data yet'}));
  opts.unshift(isGroupLevel(lv)
    ? {value: 'ALL', label: 'All groups', hint: 'no group needed'}
    : {value: 'ALL', label: 'Common courses', hint: 'no specialization'});
  groupDD.setOptions(opts, keep);
  fillCourses();
}

function fillCourses() {
  const lv = levelDD.value, key = gkey(), rows = DATA[key] || [], common = COMMON[key];
  const ids = [...new Set(rows.map(r => r.c))];
  if (common) ids.sort((a, b) => cinfo(a)[0].localeCompare(cinfo(b)[0]));
  const nGroups = GROUPS[lv].length, word = isGroupLevel(lv) ? 'groups' : 'specializations';
  $('courses').innerHTML = ids.length
    ? ids.map(c => {
        const who = common ? `<span>· ${common[c].length === nGroups ? 'all ' + word : esc(common[c].join(' · '))}</span>` : '';
        return `<label class="pill"><input type="checkbox" value="${esc(c)}"><b>${esc(cinfo(c)[0])}</b><span>(${esc(cinfo(c)[1])})</span>${who}</label>`;
      }).join('')
    : '<span class="empty-courses">No slots have been added for this group yet.</span>';
  const n = common ? allNote(lv) : NOTES[key];
  $('note').hidden = !n;
  $('note').textContent = n || '';
}

function addPending() {
  const cs = [...document.querySelectorAll('#courses input:checked')].map(i => i.value);
  if (!cs.length) return false;
  S.entries.push({key: gkey(), sec: $('sec').value.trim(), courses: cs});
  document.querySelectorAll('#courses input').forEach(i => i.checked = false);
  renderList();
  save();
  return true;
}

function renderList() {
  $('list').innerHTML = S.entries.map((e, i) =>
    `<div class="tag"><div class="tx"><b>${esc(keyLabel(e.key))}${e.sec ? ' · Sec ' + esc(e.sec) : ''}</b><br>${e.courses.map(c => esc(cfull(c))).join(', ')}</div>
     <button type="button" data-i="${i}" aria-label="Remove">×</button></div>`).join('');
}

/* ---------- 6) ENGINE ---------- */
/* Collect every slot for the active schedule's courses. A slot is auto-pinned (once) when it is the only option
   of its kind: the single lecture of a course, or the lab/tutorial of a section the user typed in. */
function build() {
  const out = [], warns = [], seenId = new Set();
  S.entries.forEach(e => {
    const rows = DATA[e.key] || [], all = e.key.endsWith('-ALL');
    const hasSec = (r, sec) => r.x === '*' || r.x.split(',').map(x => x.trim()).includes(sec);
    /* "All groups" + a section number: find the group(s) that own that section, then keep only their lectures */
    const owners = new Set();
    if (all && e.sec) rows.forEach(r => { if (e.courses.includes(r.c) && r.t !== 'L' && hasSec(r, e.sec)) r.specs.forEach(g => owners.add(g)); });
    e.courses.forEach(c => {
      const mine = rows.filter(r => r.c === c);
      const ok = mine.filter(r => r.t === 'L'
        ? (isGroupLevel(e.key[0]) && owners.size ? r.specs.some(g => owners.has(g)) : true)
        : (!e.sec || hasSec(r, e.sec)));
      ['B','T'].forEach(t => {
        if (e.sec && mine.some(r => r.t === t) && !ok.some(r => r.t === t))
          warns.push(`No ${TYPE[t].toLowerCase()} found for ${cfull(c)} section ${e.sec} in ${keyLabel(e.key)}.`);
      });
      const cnt = {};
      ok.forEach(r => cnt[r.t] = (cnt[r.t] || 0) + 1);
      ok.forEach(r => {
        const id = [e.key, r.c, r.t, r.d, r.s, r.x, r.loc, r.ins].join('|');
        if (seenId.has(id)) return;
        seenId.add(id);
        out.push({...r, id, g: e.key, all, auto: cnt[r.t] === 1});
      });
    });
  });
  return {out, warns};
}

/* View filters. Days and the time window hide everything outside them; the instructor filter only hides
   options that are NOT pinned, so a pinned class never disappears behind it. */
const dayList = () => [...activeDays].sort((a, b) => a - b);
function passes(s) {
  if (!activeDays.has(s.d)) return false;
  if (s.s < F.from || s.s + s.n > F.to) return false;
  if (F.ins && !S.sel.has(s.id) && !insNames(s.ins).includes(F.ins)) return false;
  return true;
}
const visible = () => slots.filter(passes);

/* Mark overlapping slots (same day, overlapping hours) with .bad and return the pairs */
function conflicts(list) {
  list.forEach(s => s.bad = false);
  const pairs = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.d === b.d && a.s < b.s + b.n && b.s < a.s + a.n) { a.bad = b.bad = true; pairs.push([a, b]); }
    }
  return pairs;
}

/* Compact schedule: an unpinned option that touches a pinned class on the same day is "back-to-back" (highlighted);
   one that would sit 4+ hours away from the nearest pinned class would leave a long gap (faded). */
function markCompact(vis, chosen) {
  vis.forEach(s => { s.b2b = false; s.far = false; });
  if (!F.compact) return;
  vis.forEach(s => {
    if (S.sel.has(s.id)) return;
    let gap = Infinity;
    chosen.filter(p => p.d === s.d).forEach(p => {
      const g = s.s >= p.s + p.n ? s.s - (p.s + p.n) : p.s >= s.s + s.n ? p.s - (s.s + s.n) : -1;
      if (g >= 0) gap = Math.min(gap, g);
    });
    if (gap === 0) s.b2b = true;
    else if (gap >= 4 && gap !== Infinity) s.far = true;
  });
}
function gapCount(chosen) {                  // pinned classes with 4+ empty hours between them on one day
  let n = 0;
  DAYS.forEach((_, d) => {
    const ev = chosen.filter(s => s.d === d).sort((a, b) => a.s - b.s);
    for (let i = 1; i < ev.length; i++) if (ev[i].s - (ev[i - 1].s + ev[i - 1].n) >= 4) n++;
  });
  return n;
}

/* Day load: hours on campus (first class start -> last class end) and real class hours.
   light (green) <= 4 h on campus, moderate (yellow) <= 8 h, heavy (red) beyond. */
function dayLoad(chosen, d) {
  const ev = chosen.filter(s => s.d === d).sort((a, b) => a.s - b.s);
  if (!ev.length) return {lv: 'low', txt: 'Free day', tip: 'No pinned classes'};
  const start = ev[0].s, end = Math.max(...ev.map(s => s.s + s.n));
  let cls = 0, last = -1;
  ev.forEach(s => { const a = Math.max(s.s, last), b = s.s + s.n; if (b > a) cls += b - a; last = Math.max(last, b); });
  const span = end - start;
  return {lv: span <= 4 ? 'low' : span <= 8 ? 'mid' : 'high',
          txt: `${span}h on campus \u00b7 ${cls}h class`,
          tip: `${hh(start)} \u2013 ${hh(end)}: ${span} h on campus, ${cls} h in class`};
}

const metaText = () => S.entries.map(e => `${keyLabel(e.key)}${e.sec ? ' sec ' + e.sec : ''}: ${e.courses.map(cfull).join(', ')}`).join('  |  ');

/* ---------- 7) TIMETABLE RENDERING ---------- */
/* Time axis: even hours only (8 AM, 10 AM …). Every slot is 2 h long and starts on an even hour,
   so a card always fills exactly one axis row. */
function axis(list) {
  if (!list.length) return {lo: F.from, hi: Math.max(F.to, F.from + 4)};
  const lo = Math.floor(Math.min(...list.map(s => s.s)) / 2) * 2;
  const hi = Math.ceil(Math.max(...list.map(s => s.s + s.n)) / 2) * 2;
  return {lo, hi: Math.max(hi, lo + 4)};
}

/* Side-by-side lanes for overlapping slots of one day (stable order, so cards do not jump when pinned) */
function layout(list, d) {
  const ev = list.filter(s => s.d === d)
    .sort((a, b) => a.s - b.s || a.c.localeCompare(b.c) || String(a.x).localeCompare(String(b.x), undefined, {numeric: true}) || a.loc.localeCompare(b.loc));
  const lanes = [];
  ev.forEach(s => {
    let l = lanes.findIndex(L => L.every(o => o.s + o.n <= s.s || s.s + s.n <= o.s));
    if (l < 0) { l = lanes.length; lanes.push([]); }
    lanes[l].push(s);
    s.l = l;
  });
  return {ev, n: Math.max(1, lanes.length)};
}

/* One course card: time badge, bold course name, type + section + group, instructor, quiet room line */
function card(s, lo, n, pdf) {
  const on = pdf || S.sel.has(s.id);
  const sec = s.t === 'L' ? '' : `<span class="sc">Section ${s.x === '*' ? 'all' : esc(s.x.split(',').join(', '))}</span>`;
  const time = `${hh(s.s)} \u2013 ${hh(s.s + s.n)}`;
  const tip = `${cfull(s.c)} · ${TYPE[s.t]} · ${time} · ${s.ins} · ${tagOf(s)}`;
  const cls = `${s.bad ? 'X' : s.t}${on ? ' on' : ''}${!pdf && s.b2b ? ' b2b' : ''}${!pdf && s.far ? ' far' : ''}`;
  const attrs = pdf ? '' : ` data-id="${esc(s.id)}" role="button" tabindex="0" aria-pressed="${on}"`;
  return `<div class="ev ${cls}" data-ci="${cIdx(s.c)}"${attrs} title="${esc(tip)}"
    style="top:calc(var(--h) * ${s.s - lo} + var(--pad));height:calc(var(--h) * ${s.n} - var(--pad) * 2);left:calc(${s.l * 100 / n}% + var(--pad));width:calc(${100 / n}% - var(--pad) * 2)">
    ${pdf ? '' : `<i class="chk">${CHECKSVG}</i>`}
    <span class="ev-time">${time}</span>
    <div class="ev-title">${s.bad ? warnIcon : ''}<span>${esc(cfull(s.c))}</span></div>
    <div class="ev-meta"><span class="ty">${TYPE[s.t]}</span>${sec}<span class="gp">${esc(tagOf(s))}</span><span class="flag">Back-to-back</span></div>
    <div class="ev-ins">${bd(s.ins)}</div>
    <div class="ev-loc">${locCard(s.loc)}</div></div>`;
}

/* Grid markup for any list of day indexes. list = slots to draw, chosen = pinned slots (for the day-load badges) */
function gridHTML(list, days, ax, pdf, chosen) {
  const cols = days.map(d => layout(list, d));
  let h = '<div class="corner"></div>' + days.map(d => {
    const L = dayLoad(chosen, d);
    return `<div class="dh"><span class="dn">${FULL[DAYS[d]]}</span><span class="load" data-lv="${L.lv}" title="${esc(L.tip)}">${esc(L.txt)}</span></div>`;
  }).join('');
  h += '<div class="times">' + Array.from({length: (ax.hi - ax.lo) / 2}, (_, i) => `<div>${hh(ax.lo + i * 2)}</div>`).join('') + '</div>';
  cols.forEach(({ev, n}, i) => { h += `<div class="day${i % 2 ? ' alt' : ''}">${ev.map(s => card(s, ax.lo, n, pdf)).join('')}</div>`; });
  return {html: h, cols};
}

function draw(vis, chosen, animate) {
  const g = gridHTML(vis, dayList(), axis(vis), false, chosen);
  const mob = isMobile(), tw = mob ? 52 : 76;
  const base = mob ? Math.max(240, Math.min(window.innerWidth - 110, 380)) : 240;   // mobile: ~1 day per screen, next one peeks in
  const mins = g.cols.map(c => Math.max(base, (mob ? 170 : 180) * c.n));            // wider column when many options overlap
  const tt = $('tt');
  tt.style.gridTemplateColumns = tw + 'px ' + mins.map(m => `minmax(${m}px,1fr)`).join(' ');
  tt.style.minWidth = (tw + mins.reduce((a, b) => a + b, 0)) + 'px';
  tt.className = 'tt' + (animate ? ' anim' : '');
  tt.innerHTML = g.html;
}

function refresh(animate) {
  slots.forEach(s => { s.bad = false; s.b2b = false; s.far = false; });
  const vis = visible(), chosen = vis.filter(s => S.sel.has(s.id));
  const pairs = conflicts(chosen);
  markCompact(vis, chosen);
  const msgs = pairs
    .map(([a, b]) => `Conflict on ${FULL[DAYS[a.d]]}, ${hh(Math.max(a.s, b.s))} \u2013 ${hh(Math.min(a.s + a.n, b.s + b.n))}: ${label(a)} overlaps ${label(b)}.`)
    .concat(buildWarns);
  $('warns').innerHTML = msgs.map(m => `<div class="warn" role="alert">${warnIcon}<span>${esc(m)}</span></div>`).join('');
  const gaps = F.compact ? gapCount(chosen) : 0;
  $('stats').innerHTML =
    `<span class="stat on">${chosen.length} pinned</span><span class="stat">${vis.length} options</span>` +
    `<span class="stat">${chosen.reduce((t, s) => t + s.n, 0)} h / week</span>` +
    (gaps ? `<span class="stat bad">${gaps} long gap${gaps > 1 ? 's' : ''}</span>` : '') +
    (pairs.length ? `<span class="stat bad">${pairs.length} conflict${pairs.length > 1 ? 's' : ''}</span>` : '');
  $('barmsg').textContent = !S.entries.length
    ? `Schedule ${cur} is empty \u2014 pick courses on the left and press Generate.`
    : !vis.length ? 'Nothing fits the current days / time window / instructor filters.'
    : chosen.length ? 'Click a pinned card to unpin it. Only pinned cards go into the exports.'
    : 'Nothing pinned yet \u2014 click the cards you want to attend.';
  $('meta').textContent = metaText();
  draw(vis, chosen, animate);
  renderTabs();
}

/* The timetable REPLACES the empty-state box: exactly one of the two is visible at any time */
function showEmpty(msg) {
  $('sched').hidden = true;
  $('empty').hidden = false;
  $('empty').classList.toggle('err', !!msg);
  $('empty').innerHTML = msg
    ? `<div><strong>Nothing to show yet</strong>${esc(msg)}</div>`
    : '<div><strong>Your timetable will appear here</strong>Choose your courses on the left, then press Generate Schedule.</div>';
}
function showSchedule() {
  $('empty').hidden = true;
  $('sched').hidden = false;
}

function fillIns() {                          // instructor dropdown = every name found in the current options
  const count = new Map();
  slots.forEach(s => insNames(s.ins).forEach(n => count.set(n, (count.get(n) || 0) + 1)));
  if (F.ins && !count.has(F.ins)) F.ins = '';
  const names = [...count.keys()].sort((a, b) => a.localeCompare(b));
  insDD.setOptions([{value: '', label: 'All instructors'}].concat(
    names.map(n => ({value: n, label: n, hint: count.get(n) + (count.get(n) > 1 ? ' slots' : ' slot')}))), F.ins);
}

function generate(quiet) {
  addPending();
  if (!S.entries.length) {
    if ($('sched').hidden) showEmpty('Pick at least one course, then press Generate Schedule.');
    flash('Pick at least one course, then press Generate Schedule.', true);
    return false;
  }
  const b = build();
  slots = b.out;
  buildWarns = b.warns;
  if (S.pins) {                               // schedule opened from a share link: pins come exactly from the link
    slots.forEach(s => { S.auto.add(s.id); if (S.pins.has(tok(s.id))) S.sel.add(s.id); });
    delete S.pins;
  }
  slots.forEach(s => { if (s.auto && !S.auto.has(s.id)) { S.auto.add(s.id); S.sel.add(s.id); } });   // auto-pin once; a later unpin sticks
  const ids = new Set(slots.map(s => s.id));
  [...S.sel].forEach(id => { if (!ids.has(id)) S.sel.delete(id); });
  showSchedule();
  fillIns();
  renderDays();
  refresh(true);
  save();
  if (!quiet && window.innerWidth <= 1020 && $('result').scrollIntoView) $('result').scrollIntoView({behavior: 'smooth', block: 'start'});
  return true;
}

function toggleCard(el) {
  const id = el.dataset.id;
  S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id);
  refresh(false);
  save();
  const again = [...$('tt').querySelectorAll('.ev')].find(x => x.dataset.id === id);
  if (again) again.focus({preventScroll: true});
}

/* ---------- 8) VIEW CONTROLS ---------- */
/* days shown */
function renderDays() {
  $('days').innerHTML = '<span class="dl">Days shown</span>' + DAYS.map((d, i) =>
    `<button type="button" class="chip" data-d="${i}" aria-pressed="${activeDays.has(i)}" aria-label="${FULL[d]}">
       <span class="full">${FULL[d]}</span><span class="abbr">${d}</span></button>`).join('');
}
function toggleDay(i) {
  if (activeDays.has(i)) {
    if (activeDays.size === 1) return flash('Keep at least one day visible.', true);
    activeDays.delete(i);
  } else activeDays.add(i);
  renderDays();
  refresh(false);
  save();
}

/* time window: even hours only, 8 AM - 8 PM, start always before end */
const fromDD = Dropdown($('ddFrom'), 'lblFrom', v => onRange('from', +v));
const toDD   = Dropdown($('ddTo'),   'lblTo',   v => onRange('to', +v));
function rangeMsg(extra) {
  const m = $('rangeMsg');
  m.textContent = extra || `Showing classes from ${hh(F.from)} to ${hh(F.to)}.`;
  m.classList.toggle('err', !!extra);
}
function onRange(which, v) {
  let msg = '';
  if (which === 'from') {
    F.from = v;
    if (F.from >= F.to) { F.to = F.from + 2; toDD.set(String(F.to)); msg = 'End time moved so it stays after the start.'; }
  } else {
    F.to = v;
    if (F.to <= F.from) { F.from = F.to - 2; fromDD.set(String(F.from)); msg = 'Start time moved so it stays before the end.'; }
  }
  rangeMsg(msg);
  if (!$('sched').hidden) refresh(false);
  save();
}

/* instructor filter (no room / location filtering anywhere) */
const insDD = Dropdown($('ddIns'), 'lblIns', v => {
  F.ins = v;
  if (v) flash('Showing only options taught by ' + v + ' (pinned cards stay visible).');
  if (!$('sched').hidden) refresh(false);
  save();
});

/* theme */
function setTheme(t) {
  if (!THEMES.includes(t)) return;
  theme = t;
  $('tscope').dataset.theme = t;
  document.querySelectorAll('#themes .theme').forEach(b => b.setAttribute('aria-checked', String(b.dataset.th === t)));
  save();
}

/* Schedule A / B */
function renderTabs() {
  ['A', 'B'].forEach(id => {
    $('tab' + id).setAttribute('aria-selected', String(id === cur));
    $('cnt' + id).textContent = sch[id].sel.size;
  });
}
function switchTo(id) {
  if (id === cur) return;
  cur = id; S = sch[id];
  renderList();
  if (S.entries.length) generate(true);
  else { slots = []; buildWarns = []; fillIns(); refresh(false); save(); }
  renderTabs();
}

function syncUI() {                           // push the in-memory state into every control
  $('tscope').dataset.theme = theme;
  document.querySelectorAll('#themes .theme').forEach(b => b.setAttribute('aria-checked', String(b.dataset.th === theme)));
  fromDD.set(String(F.from)); toDD.set(String(F.to)); rangeMsg();
  $('compact').checked = F.compact;
  renderDays(); renderTabs(); renderList();
}

function resetAll() {
  if (window.confirm && !window.confirm('Clear all selections, both schedules and every filter?')) return;
  sch.A = mkSch(); sch.B = mkSch(); cur = 'A'; S = sch.A;
  F.from = 8; F.to = 20; F.ins = ''; F.compact = false; theme = 'dark';
  activeDays.clear(); [0, 1, 2, 3, 4, 5].forEach(i => activeDays.add(i));
  slots = []; buildWarns = [];
  try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
  if (window.location.search && window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);
  levelDD.setOptions(levelOpts, '4'); fillGroups('ALL');
  $('sec').value = '';
  fillIns(); syncUI(); showEmpty();
  toast('Everything cleared');
}

/* ---------- 9) EXPORTS (PDF · PNG · .ics) & SHARE ---------- */
const PDF_HALVES = [[0, 1, 2], [3, 4, 5]];       // page 1 = Sat-Mon, page 2 = Tue-Thu (days the user hid are dropped)
const THEME_BG = {dark:'#0b1220', light:'#ffffff', mono:'#ffffff', vivid:'#f8fafc'};   // page colour of each theme (canvas background)
const PAGE_PX = 793;                              // A4 landscape at 1122.5 px wide is 793.7 px tall: 793 never spills to a 2nd page

const chosenVisible = () => visible().filter(s => S.sel.has(s.id)).map(s => ({...s}));    // copies: layout writes lane numbers
const halvesActive = () => PDF_HALVES.map(h => h.filter(d => activeDays.has(d))).filter(h => h.length);

/* Off-screen export element, drawn with the CURRENT theme. Solid colours only, so nothing looks washed out. */
function exportEl(groups, chosen, ax, hpx, xs, o) {
  const legend = ['L:Lecture', 'B:Lab', 'T:Tutorial', 'X:Conflict']
    .map(x => { const [k, n] = x.split(':'); return `<span><i style="background:var(--${k}bar)"></i>${n}</span>`; }).join('');
  const grids = groups.map(days => ({days, g: gridHTML(chosen, days, ax, true, chosen)}));
  const none = !grids.some(x => x.g.cols.some(c => c.ev.length));
  const el = document.createElement('div');
  el.className = 'export';
  el.dataset.theme = theme;
  if (o.width) el.style.width = o.width + 'px';
  el.innerHTML = `<section class="xp-page" style="${o.height ? 'height:' + o.height + 'px;' : ''}--xs:${xs}">
    <header class="xp-head">
      <div><b class="xp-brand">Gridify</b><span class="xp-title">Weekly schedule \u00b7 Fall 2026-2027</span></div>
      <div class="xp-pg">${legend}<span>${o.pageText}</span></div>
    </header>
    <p class="xp-meta">${esc(metaText())}</p>
    ${grids.map(({days, g}, i) => `<div class="tt xp-grid" style="--h:${hpx}px;grid-template-columns:62px repeat(${days.length},minmax(0,1fr));${i ? 'margin-top:14px' : ''}">${g.html}</div>`).join('')}
    ${none ? '<p class="xp-none">No pinned sessions.</p>' : ''}
  </section>`;
  return el;
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function needPinned() {
  if (!slots.length) { flash('Generate a schedule first, then pin the cards you want.', true); return null; }
  const chosen = chosenVisible();
  if (!chosen.length) { flash('Pin at least one visible card first \u2014 only pinned cards are exported.', true); return null; }
  conflicts(chosen);
  return chosen;
}

/* PDF: every page is its OWN element rendered to a canvas and added as exactly one A4-landscape page, so html2pdf
   never slices anything (slicing was the cause of blank pages). */
async function downloadPDF() {
  const chosen = needPinned();
  if (!chosen) return;
  if (typeof html2pdf === 'undefined') return flash('The PDF library could not be loaded. Check your connection and reload.', true);
  const ax = axis(chosen), rows = ax.hi - ax.lo;
  const hpx = Math.max(30, Math.min(100, Math.floor(640 / rows)));          // hour height so the grid always fits one page
  const xs = Math.max(8, Math.min(11, +(hpx / 5.6).toFixed(1)));            // card text scales with the hour height
  const halves = halvesActive();
  const pages = halves.map((days, i) => exportEl([days], chosen, ax, hpx, xs,
    {height: PAGE_PX, pageText: `Page ${i + 1} of ${halves.length} \u00b7 ${days.map(d => FULL[DAYS[d]]).join(', ')}`}));

  const btn = $('pdf'), lbl = $('pdfLabel'), y = window.scrollY;
  btn.disabled = true; lbl.textContent = 'Preparing PDF\u2026';
  try {
    window.scrollTo(0, 0);                                                  // html2canvas mis-positions content on a scrolled page
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const opt = {
      margin: 0, filename: 'Gridify-schedule.pdf',
      image: {type: 'jpeg', quality: 1},
      html2canvas: {scale: 3, useCORS: true, backgroundColor: THEME_BG[theme], logging: false, scrollX: 0, scrollY: 0},
      jsPDF: {unit: 'mm', format: 'a4', orientation: 'landscape'},
      pagebreak: {mode: []}                                                 // no automatic breaks: we add every page ourselves
    };
    let w = html2pdf().set(opt);
    pages.forEach((pg, i) => {
      if (i > 0) w = w.get('pdf').then(pdf => { pdf.addPage(); });
      w = w.from(pg).toCanvas().toPdf();
    });
    await w.save();
    toast('PDF downloaded \u2713');
  } catch (err) {
    console.error(err);
    flash('Could not create the PDF. Please try again.', true);
  } finally {
    window.scrollTo(0, y);
    btn.disabled = false; lbl.textContent = 'Download PDF';
  }
}

/* PNG: one tall 1080 px wide image (Sat-Mon above Tue-Thu) at 3x, sized like a phone wallpaper */
async function downloadPNG() {
  const chosen = needPinned();
  if (!chosen) return;
  if (typeof html2canvas === 'undefined') return flash('The image library could not be loaded. Check your connection and reload.', true);
  const ax = axis(chosen);
  const el = exportEl(halvesActive(), chosen, ax, 74, 11, {width: 1080, pageText: 'My weekly schedule'});
  el.style.position = 'absolute'; el.style.left = '-30000px'; el.style.top = '0';
  document.body.appendChild(el);
  const btn = $('png'), lbl = $('pngLabel'), y = window.scrollY;
  btn.disabled = true; lbl.textContent = 'Rendering image\u2026';
  try {
    window.scrollTo(0, 0);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const canvas = await html2canvas(el, {
      scale: isMobile() ? 2 : 3, useCORS: true, logging: false, scrollX: 0, scrollY: 0, windowWidth: 1080,
      backgroundColor: THEME_BG[theme]
    });
    await new Promise((res, rej) => canvas.toBlob(b => b ? (saveBlob(b, 'Gridify-schedule.png'), res()) : rej(new Error('empty canvas')), 'image/png'));
    toast('Image downloaded \u2713');
  } catch (err) {
    console.error(err);
    flash('Could not create the image. Please try again.', true);
  } finally {
    el.remove();
    window.scrollTo(0, y);
    btn.disabled = false; lbl.textContent = 'Download Image (PNG)';
  }
}

/* .ics: a weekly repeating event (16 weeks) for every pinned, visible class, starting on the next matching weekday */
const ICS_JSDAY = [6, 0, 1, 2, 3, 4];             // JS getDay() for Sat Sun Mon Tue Wed Thu
const ICS_BYDAY = ['SA', 'SU', 'MO', 'TU', 'WE', 'TH'];
const p2 = n => String(n).padStart(2, '0');
const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function nextDate(dayIdx) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((ICS_JSDAY[dayIdx] - d.getDay() + 7) % 7));
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
}
function foldLine(line) {                          // RFC 5545: lines are at most 75 bytes, continued with CRLF + space
  const enc = new TextEncoder();
  let out = '', part = '', bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 73) { out += part + '\r\n '; part = ch; bytes = b + 1; }
    else { part += ch; bytes += b; }
  }
  return out + part;
}
function buildICS(chosen) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gridify//Schedule Builder//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
             'X-WR-CALNAME:Gridify \u2013 Fall 2026-2027', 'X-WR-TIMEZONE:Africa/Cairo'];
  chosen.forEach((s, i) => {
    const day = nextDate(s.d);
    const desc = [s.t === 'L' ? 'Lecture' : `${TYPE[s.t]} \u2013 section ${s.x}`, 'Instructor: ' + s.ins, 'Group: ' + tagOf(s)].join('\n');
    L.push('BEGIN:VEVENT',
      `UID:gridify-${i}-${stamp}-${tok(s.id).replace(/[^\w~.-]/g, '')}@gridify.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${day}T${p2(s.s)}0000`,
      `DTEND:${day}T${p2(s.s + s.n)}0000`,
      `RRULE:FREQ=WEEKLY;COUNT=16;BYDAY=${ICS_BYDAY[s.d]}`,
      `SUMMARY:${icsEsc(cfull(s.c) + ' \u2013 ' + TYPE[s.t])}`,
      `LOCATION:${icsEsc(locText(s.loc))}`,
      `DESCRIPTION:${icsEsc(desc)}`,
      'END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.map(foldLine).join('\r\n') + '\r\n';
}
function downloadICS() {
  const chosen = needPinned();
  if (!chosen) return;
  saveBlob(new Blob([buildICS(chosen)], {type: 'text/calendar;charset=utf-8'}), 'Gridify-schedule.ics');
  toast(`Calendar file downloaded \u2713 (${chosen.length} weekly events)`);
}

/* Share link: ?level=…&group=…&courses=KEY:SEC:C1+C2;…&theme=…&time=8-16&days=012345&ins=…&compact=1&pins=… */
function shareURL() {
  const u = new URL(window.location.href);
  u.search = ''; u.hash = '';
  const p = u.searchParams;
  p.set('level', levelDD.value);
  p.set('group', groupDD.value);
  p.set('courses', S.entries.map(e => `${e.key}:${e.sec}:${e.courses.join('+')}`).join(';'));
  p.set('theme', theme);
  p.set('time', `${F.from}-${F.to}`);
  p.set('days', dayList().join(''));
  if (F.ins) p.set('ins', F.ins);
  if (F.compact) p.set('compact', '1');
  if (S.sel.size) p.set('pins', [...S.sel].map(tok).join(';'));
  return u.toString();
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { /* ignore */ }
    ta.remove();
    return ok;
  }
}
async function shareSchedule() {
  if (!S.entries.length) return flash('Add some courses first, then share your schedule.', true);
  const ok = await copyText(shareURL());
  if (ok) toast('Link copied!'); else flash('Could not copy the link. Your browser blocked clipboard access.', true);
}

/* ---------- 10) FREE SLOT FINDER ---------- */
const fDay  = Dropdown($('ddFDay'),  'lblFDay',  () => {});
const fFrom = Dropdown($('ddFFrom'), 'lblFFrom', v => { if (+v >= +fTo.value) fTo.set(String(+v + 2)); });
const fTo   = Dropdown($('ddFTo'),   'lblFTo',   v => { if (+v <= +fFrom.value) fFrom.set(String(+v - 2)); });
let finderOpener = null;

function openFinder() {
  finderOpener = document.activeElement;
  $('finder').hidden = false;
  $('fResults').innerHTML = '';
  $('fClose').focus();
}
function closeFinder() {
  $('finder').hidden = true;
  if (finderOpener && finderOpener.focus) finderOpener.focus();
}
function runFinder() {
  const d = +fDay.value, from = +fFrom.value, to = +fTo.value, out = $('fResults');
  if (!slots.length) { out.innerHTML = '<div class="fr-empty">Generate a schedule first \u2014 the finder searches the courses in it.</div>'; return; }
  const chosen = slots.filter(s => S.sel.has(s.id));
  const hits = slots.filter(s => s.d === d && s.s >= from && s.s + s.n <= to).map(s => {
    const clash = chosen.find(p => p.id !== s.id && p.d === s.d && p.s < s.s + s.n && s.s < p.s + p.n);
    return {s, clash, pinned: S.sel.has(s.id)};
  }).sort((a, b) => a.s.s - b.s.s || (a.clash ? 1 : 0) - (b.clash ? 1 : 0));
  const head = `${FULL[DAYS[d]]}, ${hh(from)} \u2013 ${hh(to)}`;
  if (!hits.length) { out.innerHTML = `<div class="fr-empty">None of your selected courses meet on ${esc(head)}.</div>`; return; }
  out.innerHTML = hits.map(({s, clash, pinned}) => `<div class="fr-item">
      <b>${esc(cfull(s.c))}</b>
      <span class="fr-time">${hh(s.s)} \u2013 ${hh(s.s + s.n)}</span>
      <span>${TYPE[s.t]}${s.t === 'L' ? '' : ' \u00b7 Section ' + esc(s.x)} \u00b7 ${esc(tagOf(s))}</span>
      <span>${bd(s.ins)}</span>
      <span>${pinned ? 'Already in your schedule' : clash ? 'Overlaps ' + esc(cfull(clash.c)) : 'Fits your schedule'}</span></div>`).join('');
}

/* ---------- 11) EVENTS & START-UP ---------- */
$('add').addEventListener('click', addPending);
$('gen').addEventListener('click', () => generate());
$('reset').addEventListener('click', resetAll);
$('pdf').addEventListener('click', downloadPDF);
$('png').addEventListener('click', downloadPNG);
$('ics').addEventListener('click', downloadICS);
$('share').addEventListener('click', shareSchedule);
$('clear').addEventListener('click', () => { S.sel.clear(); refresh(false); save(); });
$('days').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) toggleDay(+b.dataset.d); });
$('themes').addEventListener('click', e => { const b = e.target.closest('.theme'); if (b) setTheme(b.dataset.th); });
$('tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) switchTo(b.dataset.sch); });
$('compact').addEventListener('change', () => { F.compact = $('compact').checked; refresh(false); save(); });
$('list').addEventListener('click', e => {
  const i = e.target.dataset.i;
  if (i === undefined) return;
  S.entries.splice(+i, 1);
  renderList();
  if (!S.entries.length) {
    slots = []; buildWarns = []; S.sel.clear(); S.auto.clear();
    fillIns();
    if (sch.A.entries.length || sch.B.entries.length) refresh(false); else showEmpty();
    save();
  } else if (!$('sched').hidden) generate(true);
  else save();
});
$('tt').addEventListener('click', e => { const el = e.target.closest('.ev'); if (el) toggleCard(el); });
$('tt').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ev')) {
    e.preventDefault();
    toggleCard(e.target);
  }
});
$('findFree').addEventListener('click', openFinder);
$('fClose').addEventListener('click', closeFinder);
$('fSearch').addEventListener('click', runFinder);
$('finder').addEventListener('mousedown', e => { if (e.target === $('finder')) closeFinder(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('finder').hidden) closeFinder(); });
let resizeTimer;
window.addEventListener('resize', () => {                 // re-fit the day columns when the viewport changes (rotate, resize)
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (!$('sched').hidden) refresh(false); }, 150);
});

(function init() {
  levelDD.setOptions(levelOpts, '4');
  fromDD.setOptions(FROM_OPTS, '8');  toDD.setOptions(TO_OPTS, '20');
  fDay.setOptions(DAYS.map((d, i) => ({value: String(i), label: FULL[d]})), '0');
  fFrom.setOptions(FROM_OPTS, '8');   fTo.setOptions(TO_OPTS, '20');
  insDD.setOptions([{value: '', label: 'All instructors'}], '');
  const url = readURL(), saved = url ? null : loadSaved();
  if (url || saved) applySettings(url || saved, !!url); else fillGroups();
  syncUI();
  if (S.entries.length) generate(true); else showEmpty();
  if (url) toast('Shared schedule loaded');
})();
/* END OF app.js */