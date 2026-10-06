/* =====================================================================
   GRIDIFY — app.js
   1 Constants & parser · 2 Helpers · 3 Dropdown · 4 Control panel · 5 Engine
   6 Day filter · 7 Timetable rendering · 8 PDF export · 9 Events & start-up
   Uses COURSES, NOTES, LOCS, GROUPS, RAW_PARTS (data files) and html2pdf (CDN).
   ===================================================================== */

/* ---------- 1) CONSTANTS & PARSER ---------- */
const DAYS = ['Sat','Sun','Mon','Tue','Wed','Thu'];
const FULL = {Sat:'Saturday',Sun:'Sunday',Mon:'Monday',Tue:'Tuesday',Wed:'Wednesday',Thu:'Thursday'};
const TYPE = {L:'Lecture',B:'Lab',T:'Tutorial'};
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
const lpair    = k => LOCS[k] || ['', k];
const locCard  = k => { const [a, e] = lpair(k); return bd(a || e); };
const locText  = k => { const [a, e] = lpair(k); return a ? `${a} · ${e}` : e; };
const keyLabel = k => { const [lv, g] = k.split('-'); return g === 'ALL' ? `L${lv} · ${isGroupLevel(lv) ? 'All groups' : 'Common'}` : `L${lv} · ${g}`; };
const tagOf    = s => s.all ? `L${s.g.split('-')[0]} · ${s.specs.join(' + ')}` : keyLabel(s.g);
const hh       = h => `${h % 12 || 12} ${h >= 12 && h < 24 ? 'PM' : 'AM'}`;     // 8 -> "8 AM", 14 -> "2 PM"
const label    = s => `${cfull(s.c)} ${TYPE[s.t].toLowerCase()}`;
const warnIcon = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 2 17h16L10 3Zm0 5v4m0 2.5v.01"/></svg>';
const CHECKSVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 10.5 3.5 3.5 7.5-8"/></svg>';

let entries = [];           // [{key, sec, courses:[ids]}]
let slots = [];             // every available slot for the chosen courses
let buildWarns = [];        // warnings produced while collecting slots
const sel = new Set();      // ids of the slots the user pinned
const autoSeen = new Set(); // ids already auto-pinned once (so a manual unpin sticks)
const activeDays = new Set([0, 1, 2, 3, 4, 5]);     // days the user keeps visible

let flashTimer;
function flash(msg, isErr) {
  const f = $('flash');
  f.textContent = msg;
  f.classList.toggle('err', !!isErr);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { f.textContent = ''; }, 4500);
}

/* ---------- 3) CUSTOM DROPDOWN ----------
   Dropdown(rootEl, labelId, onChange) -> { value, setOptions(list, selectedValue), close() }
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
  const api = { get value() { return opts[sel] ? opts[sel].value : ''; }, setOptions, close };

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
    if (k === 'Escape') { if (isOpen) { e.preventDefault(); close(); } return; }
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

/* ---------- 4) CONTROL PANEL ---------- */
const levelDD = Dropdown($('ddLevel'), 'lblLevel', () => fillGroups());
const groupDD = Dropdown($('ddGroup'), 'lblGroup', () => fillCourses());
const gkey = () => levelDD.value + '-' + groupDD.value;

function fillGroups() {
  const lv = levelDD.value, keep = groupDD.value;
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
  entries.push({key: gkey(), sec: $('sec').value.trim(), courses: cs});
  document.querySelectorAll('#courses input').forEach(i => i.checked = false);
  renderList();
  return true;
}

function renderList() {
  $('list').innerHTML = entries.map((e, i) =>
    `<div class="tag"><div class="tx"><b>${esc(keyLabel(e.key))}${e.sec ? ' · Sec ' + esc(e.sec) : ''}</b><br>${e.courses.map(c => esc(cfull(c))).join(', ')}</div>
     <button type="button" data-i="${i}" aria-label="Remove">×</button></div>`).join('');
}

/* ---------- 5) ENGINE ---------- */
/* Collect every slot for the chosen courses. A slot is auto-pinned when it is the only option of its kind
   (the single lecture of a course, or the lab/tutorial of a section the user typed in). */
function build() {
  const out = [], warns = [], seenId = new Set();
  entries.forEach(e => {
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

const metaText = () => entries.map(e => `${keyLabel(e.key)}${e.sec ? ' sec ' + e.sec : ''}: ${e.courses.map(cfull).join(', ')}`).join('  |  ');

/* ---------- 6) DAY FILTER ---------- */
const dayList = () => [...activeDays].sort((a, b) => a - b);
const visible = () => slots.filter(s => activeDays.has(s.d));

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
}

/* ---------- 7) TIMETABLE RENDERING ---------- */
/* Time axis: even hours only (8 AM, 10 AM …). Every slot is 2 h long and starts on an even hour,
   so a card always fills exactly one axis row. */
function axis(list) {
  if (!list.length) return {lo: 8, hi: 14};
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

function card(s, lo, n, pdf) {
  const on = pdf || sel.has(s.id);
  const sec = s.t === 'L' ? '' : `<span class="sc">Section ${s.x === '*' ? 'all' : esc(s.x.split(',').join(', '))}</span>`;
  const tip = `${cfull(s.c)} · ${TYPE[s.t]} · ${locText(s.loc)} · ${s.ins} · ${hh(s.s)} – ${hh(s.s + s.n)} · ${tagOf(s)}`;
  const attrs = pdf ? '' : ` data-id="${esc(s.id)}" role="button" tabindex="0" aria-pressed="${on}"`;
  return `<div class="ev ${s.bad ? 'X' : s.t}${on ? ' on' : ''}"${attrs} title="${esc(tip)}"
    style="top:calc(var(--h) * ${s.s - lo} + var(--pad));height:calc(var(--h) * ${s.n} - var(--pad) * 2);left:calc(${s.l * 100 / n}% + var(--pad));width:calc(${100 / n}% - var(--pad) * 2)">
    ${pdf ? '' : `<i class="chk">${CHECKSVG}</i>`}
    <div class="hd">${s.bad ? warnIcon.replace('<svg', '<svg width="14" height="14"') : ''}<span>${esc(cfull(s.c))}</span></div>
    <div class="mr"><span class="ty">${TYPE[s.t]}</span>${sec}</div>
    <span class="lc">${locCard(s.loc)}</span>
    <span class="in">${bd(s.ins)}</span>
    <span class="tm">${hh(s.s)} – ${hh(s.s + s.n)} · ${esc(tagOf(s))}</span></div>`;
}

/* Grid markup for any list of day indexes (the live view uses the active days, each PDF page uses its own) */
function gridHTML(list, days, ax, pdf) {
  const cols = days.map(d => layout(list, d));
  let h = '<div class="corner"></div>' + days.map(d => `<div class="dh">${FULL[DAYS[d]]}</div>`).join('');
  h += '<div class="times">' + Array.from({length: (ax.hi - ax.lo) / 2}, (_, i) => `<div>${hh(ax.lo + i * 2)}</div>`).join('') + '</div>';
  cols.forEach(({ev, n}, i) => { h += `<div class="day${i % 2 ? ' alt' : ''}">${ev.map(s => card(s, ax.lo, n, pdf)).join('')}</div>`; });
  return {html: h, cols};
}

function draw(animate) {
  const vis = visible(), g = gridHTML(vis, dayList(), axis(vis), false);
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
  slots.forEach(s => s.bad = false);
  const vis = visible(), chosen = vis.filter(s => sel.has(s.id));
  const pairs = conflicts(chosen);
  const msgs = pairs
    .map(([a, b]) => `Conflict on ${FULL[DAYS[a.d]]}, ${hh(Math.max(a.s, b.s))} – ${hh(Math.min(a.s + a.n, b.s + b.n))}: ${label(a)} overlaps ${label(b)}.`)
    .concat(buildWarns);
  $('warns').innerHTML = msgs.map(m => `<div class="warn" role="alert">${warnIcon}<span>${esc(m)}</span></div>`).join('');
  $('stats').innerHTML =
    `<span class="stat on">${chosen.length} pinned</span><span class="stat">${vis.length} options</span>` +
    `<span class="stat">${chosen.reduce((t, s) => t + s.n, 0)} h / week</span>` +
    (pairs.length ? `<span class="stat bad">${pairs.length} conflict${pairs.length > 1 ? 's' : ''}</span>` : '');
  $('barmsg').textContent = chosen.length
    ? 'Click a pinned card to unpin it. Only pinned cards go into the PDF.'
    : 'Nothing pinned yet \u2014 click the cards you want to attend.';
  $('meta').textContent = metaText();
  draw(animate);
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

function generate() {
  addPending();
  if (!entries.length) { showEmpty('Pick at least one course, then press Generate Schedule.'); return false; }
  const b = build();
  slots = b.out;
  buildWarns = b.warns;
  slots.forEach(s => { if (s.auto && !autoSeen.has(s.id)) { autoSeen.add(s.id); sel.add(s.id); } });   // auto-pin once; a later unpin sticks
  const ids = new Set(slots.map(s => s.id));
  [...sel].forEach(id => { if (!ids.has(id)) sel.delete(id); });
  showSchedule();
  renderDays();
  refresh(true);
  if (window.innerWidth <= 1020 && $('result').scrollIntoView) $('result').scrollIntoView({behavior: 'smooth', block: 'start'});
  return true;
}

function toggleCard(el) {
  const id = el.dataset.id;
  sel.has(id) ? sel.delete(id) : sel.add(id);
  refresh(false);
  const again = [...$('tt').querySelectorAll('.ev')].find(x => x.dataset.id === id);
  if (again) again.focus({preventScroll: true});
}

/* ---------- 8) PDF EXPORT (html2pdf, direct download) ----------
   The live grid is never touched. Each PDF page is its OWN small off-screen element that is rendered to a
   canvas and added to the PDF as exactly one A4-landscape page, so html2pdf never has to slice anything
   (that slicing is what created blank pages). Only pinned cards on visible days are included.
   Pages follow the week split: Sat-Mon and Tue-Thu; a half with no visible day gets no page at all. */
const PDF_HALVES = [[0, 1, 2], [3, 4, 5]];
const PAGE_PX = 792;      // page element height (A4 landscape at 1122.5 px wide is 793.7 px tall; 1.7 px slack avoids a 2nd page)

function pdfPageEl(n, total, days, chosen, ax, hpx) {
  const g = gridHTML(chosen, days, ax, true);
  const none = !g.cols.some(c => c.ev.length);
  const legend = '<span><i class="dot-l"></i>Lecture</span><span><i class="dot-b"></i>Lab</span>' +
                 '<span><i class="dot-t"></i>Tutorial</span><span><i class="dot-x"></i>Conflict</span>';
  const el = document.createElement('div');
  el.className = 'pdf-root';
  el.innerHTML = `<section class="pdf-page" style="height:${PAGE_PX}px">
    <header class="pdf-head">
      <div><b class="pdf-brand">Gridify</b><span class="pdf-title">Weekly schedule \u00b7 Fall 2026-2027</span></div>
      <div class="pdf-pg">${legend}<span>Page ${n} of ${total} \u00b7 ${days.map(d => FULL[DAYS[d]]).join(', ')}</span></div>
    </header>
    <p class="pdf-meta">${esc(metaText())}</p>
    <div class="tt pdf-grid" style="--h:${hpx}px;grid-template-columns:62px repeat(${days.length},minmax(0,1fr))">${g.html}</div>
    ${none ? '<p class="pdf-none">No pinned sessions on these days.</p>' : ''}
  </section>`;
  return el;
}

async function downloadPDF() {
  if (!slots.length) return flash('Generate a schedule first, then pin the cards you want.', true);
  const chosen = visible().filter(s => sel.has(s.id)).map(s => ({...s}));    // copies: layout writes lane numbers
  if (!chosen.length) return flash('Pin at least one card on a visible day first \u2014 only pinned cards are exported.', true);
  if (typeof html2pdf === 'undefined') return flash('The PDF library could not be loaded. Check your connection and reload.', true);

  conflicts(chosen);
  const ax = axis(chosen), rows = ax.hi - ax.lo;
  const hpx = Math.max(30, Math.min(100, Math.floor(640 / rows)));     // hour height so the grid always fits one page
  const halves = PDF_HALVES.map(h => h.filter(d => activeDays.has(d))).filter(h => h.length);
  const pages = halves.map((days, i) => pdfPageEl(i + 1, halves.length, days, chosen, ax, hpx));

  const btn = $('pdf'), lbl = $('pdfLabel'), y = window.scrollY;
  btn.disabled = true;
  lbl.textContent = 'Preparing PDF\u2026';
  try {
    window.scrollTo(0, 0);                              // html2canvas mis-positions content when the page is scrolled
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const opt = {
      margin: 0,
      filename: 'Gridify-schedule.pdf',
      image: {type: 'jpeg', quality: 0.98},
      html2canvas: {scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, scrollX: 0, scrollY: 0},
      jsPDF: {unit: 'mm', format: 'a4', orientation: 'landscape'},
      pagebreak: {mode: []}                             // no automatic page breaks: we add every page ourselves
    };
    let w = html2pdf().set(opt);
    pages.forEach((pg, i) => {
      if (i > 0) w = w.get('pdf').then(pdf => { pdf.addPage(); });      // start a fresh page, then draw into it
      w = w.from(pg).toCanvas().toPdf();
    });
    await w.save();
    flash('PDF downloaded \u2713');
  } catch (err) {
    console.error(err);
    flash('Could not create the PDF. Please try again.', true);
  } finally {
    window.scrollTo(0, y);
    btn.disabled = false;
    lbl.textContent = 'Download as PDF';
  }
}

/* ---------- 9) EVENTS & START-UP ---------- */
$('add').addEventListener('click', addPending);
$('gen').addEventListener('click', generate);
$('pdf').addEventListener('click', downloadPDF);
$('clear').addEventListener('click', () => { sel.clear(); refresh(false); });
$('days').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) toggleDay(+b.dataset.d); });
$('list').addEventListener('click', e => {
  const i = e.target.dataset.i;
  if (i === undefined) return;
  entries.splice(+i, 1);
  renderList();
  if (!entries.length) { slots = []; sel.clear(); showEmpty(); }
  else if (!$('sched').hidden) generate();
});
$('tt').addEventListener('click', e => { const el = e.target.closest('.ev'); if (el) toggleCard(el); });
$('tt').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ev')) {
    e.preventDefault();
    toggleCard(e.target);
  }
});
let resizeTimer;
window.addEventListener('resize', () => {                 // re-fit the day columns when the viewport changes (rotate, resize)
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (!$('sched').hidden) draw(false); }, 150);
});

levelDD.setOptions([1, 2, 3, 4].map(n => ({value: String(n), label: 'Level ' + n})), '4');
fillGroups();
renderDays();
/* END OF app.js */