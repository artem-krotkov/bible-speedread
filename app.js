'use strict';

// Данные: window.BIBLE = {ot: 39, books: [{n: название, s: сокращение, c: [[стих, ...], ...]}]}
const BOOKS = window.BIBLE.books;
const OT = window.BIBLE.ot;
const START = { b: OT, c: 0, i: 0 }; // От Матфея 1:1
const WPM_MIN = 100;
const WPM_MAX = 1000;

const $ = (id) => document.getElementById(id);
const body = document.body;
const el = {
  reader: $('reader'), ref: $('ref'), bar: $('bar'), word: $('word'),
  wl: $('wl'), wp: $('wp'), wr: $('wr'), context: $('context'),
  wpm: $('wpm'), menu: $('menu'), menuTitle: $('menu-title'),
  menuBack: $('menu-back'), menuList: $('menu-list'), tabs: $('tabs'),
};

// ---------- хранилище ----------

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem('rsvp.' + key));
    return v ?? fallback;
  } catch (e) {
    return fallback;
  }
}

function store(key, value) {
  try { localStorage.setItem('rsvp.' + key, JSON.stringify(value)); } catch (e) { /* без сохранения */ }
}

// ---------- разбивка главы на слова ----------

const LETTER = /[\p{L}\p{N}]/u;
// короткие служебные слова мелькают и проскакивают - показываем их вместе с основным словом:
// эти - со следующим («и сказал», «в доме», «не ходит»), эти - с предыдущим («знаешь ли»)
const BEFORE = new Set(['и', 'а', 'в', 'во', 'к', 'ко', 'с', 'со', 'о', 'об', 'у', 'на', 'по', 'от', 'за', 'из', 'до', 'не', 'ни']);
const AFTER = new Set(['ли', 'же', 'ж', 'бы', 'б']);
const NEG = new Set(['не', 'ни']);
const CHUNK_MAX = 4;
const bare = (w) => w.toLowerCase().replace(/^["«(]+/, '');
// конец предложения, в том числе внутри прямой речи: «камни?",», «так? —»
const SENT_END = /[.!?…]["»”')]*(\s*[,;:\-—]["»”')]*)?$/;
const cache = new Map();

// показ: t - текст, v - стих, o - номер первого слова в стихе, k - сколько слов,
// m - границы основного слова в t (на нём красная буква), w - номер показа в стихе,
// s - первое слово предложения (после паузы на точке/вопросе глазу нужно время)
function tokensOf(b, c) {
  const key = b + ':' + c;
  if (cache.has(key)) return cache.get(key);
  const book = BOOKS[b];
  const title = book.s === 'Пс' ? 'Псалом ' + (c + 1) : book.n + ', глава ' + (c + 1);
  const list = [{ t: title, h: true, v: -1, o: 0, w: 0, k: 0 }];
  let afterEnd = true;
  book.c[c].forEach((verse, v) => {
    const words = [];
    for (const part of verse.split(/\s+/)) {
      if (!part) continue;
      // тире и одиночные знаки приклеиваем к предыдущему слову
      if (!LETTER.test(part) && words.length) words[words.length - 1] += ' ' + part;
      else words.push(part);
    }
    const units = [];
    let k = 0;
    while (k < words.length) {
      const from = k;
      while (BEFORE.has(bare(words[k])) && k + 1 < words.length && k - from + 1 < CHUNK_MAX) k++;
      const main = k;
      const next = words[k + 1];
      if (next && AFTER.has(bare(next).replace(/[^\p{L}]/gu, '')) && k - from + 1 < CHUNK_MAX) k++;
      const parts = words.slice(from, k + 1);
      const start = words.slice(from, main).reduce((n, w) => n + w.length + 1, 0);
      units.push({
        t: parts.join(' '),
        o: from,
        k: parts.length,
        m: [start, start + words[main].length],
        g: words.slice(from, main).some((w) => NEG.has(bare(w))),
      });
      k++;
    }
    units.forEach((u, w) => {
      list.push({ ...u, v, w, e: w === units.length - 1, s: afterEnd });
      afterEnd = SENT_END.test(u.t);
    });
  });
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  cache.set(key, list);
  return list;
}

// ---------- позиция ----------

// в памяти позиция - номер показа {b, c, i}; сохраняется как стих и номер слова {b, c, v, o},
// чтобы изменения разбивки на показы не сдвигали сохранённое место
function freeze(p) {
  const t = tokensOf(p.b, p.c)[p.i];
  return { b: p.b, c: p.c, v: t.v, o: t.o };
}

function resolve(s) {
  if (!s || !BOOKS[s.b] || !BOOKS[s.b].c[s.c]) return null;
  const list = tokensOf(s.b, s.c);
  if (s.v === undefined) return s.i >= 0 && s.i < list.length ? { b: s.b, c: s.c, i: s.i } : null; // старый формат
  let i = 0;
  for (let k = 0; k < list.length; k++) if (list[k].v < s.v || (list[k].v === s.v && list[k].o <= s.o)) i = k;
  return { b: s.b, c: s.c, i };
}

// для записей старого формата {b, c, i}
const normalize = (s) => (s && s.v === undefined ? (resolve(s) ? freeze(resolve(s)) : null) : s);

let pos = resolve(load('pos', null)) || { ...START };
let wpm = Math.min(WPM_MAX, Math.max(WPM_MIN, load('wpm', 300)));

const cur = () => tokensOf(pos.b, pos.c)[pos.i];

function nextChapter(p) {
  if (p.c + 1 < BOOKS[p.b].c.length) return { b: p.b, c: p.c + 1 };
  if (p.b + 1 < BOOKS.length) return { b: p.b + 1, c: 0 };
  return null;
}

function prevChapter(p) {
  if (p.c > 0) return { b: p.b, c: p.c - 1 };
  if (p.b > 0) return { b: p.b - 1, c: BOOKS[p.b - 1].c.length - 1 };
  return null;
}

function advance() {
  if (pos.i + 1 < tokensOf(pos.b, pos.c).length) {
    pos.i++;
    return true;
  }
  const n = nextChapter(pos);
  if (!n) return false;
  pos = { ...n, i: 0 };
  return true;
}

function verseStart(b, c, v) {
  return tokensOf(b, c).findIndex((t) => t.v === v);
}

function prevVerse() {
  const t = cur();
  if (t.w > 0) {
    pos.i = verseStart(pos.b, pos.c, t.v);
  } else if (t.v > 0) {
    pos.i = verseStart(pos.b, pos.c, t.v - 1);
  } else if (t.v === 0) {
    pos.i = 0;
  } else {
    const p = prevChapter(pos);
    if (!p) return;
    pos = { ...p, i: verseStart(p.b, p.c, BOOKS[p.b].c[p.c].length - 1) };
  }
  showPaused();
}

function nextVerse() {
  const t = cur();
  const i = verseStart(pos.b, pos.c, t.v + 1);
  if (i > 0) {
    pos.i = i;
  } else {
    const n = nextChapter(pos);
    if (!n) return;
    pos = { ...n, i: 0 };
  }
  showPaused();
}

// ---------- отрисовка ----------

function pivotIndex(t) {
  const letters = [];
  for (let i = 0; i < t.length; i++) if (LETTER.test(t[i])) letters.push(i);
  if (!letters.length) return 0;
  const n = letters.length;
  // у очень длинных слов фокус ближе к середине, иначе слово пришлось бы сильно уменьшать
  const k = n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : Math.round(n * 0.4);
  return letters[k];
}

// фокус считаем по всей связке («и не стоит»), чтобы она не уезжала влево,
// но красную букву ставим только в основное слово - ближайшую к этой точке
function pivotOf(t) {
  const [a, z] = t.m;
  const p = pivotIndex(t.t);
  if (p >= a && p < z) return p;
  const letters = [];
  for (let i = a; i < z; i++) if (LETTER.test(t.t[i])) letters.push(i);
  if (!letters.length) return p;
  return p < a ? letters[0] : letters[letters.length - 1];
}

let baseFs = 44;

function measure() {
  const w = el.word.clientWidth || window.innerWidth - 32;
  baseFs = Math.max(30, Math.min(60, w * 0.11));
  el.word.style.setProperty('--line', Math.ceil(baseFs * 1.3) + 'px');
}

function render() {
  const t = cur();
  if (t.h) {
    el.word.classList.add('heading');
    el.wl.textContent = '';
    el.wp.textContent = t.t;
    el.wr.textContent = '';
    el.word.style.setProperty('--fs', baseFs + 'px');
  } else {
    el.word.classList.remove('heading');
    const p = pivotOf(t);
    el.wl.textContent = t.t.slice(0, p);
    el.wp.textContent = t.t[p] || '';
    el.wr.textContent = t.t.slice(p + 1);
    // крупно, но так, чтобы длинное слово влезло по обе стороны от красной буквы
    const half = Math.max(p, t.t.length - p - 1) + 0.5;
    const w = el.word.clientWidth || window.innerWidth - 32;
    const fs = Math.min(baseFs, (w / 2) * 0.96 / (half * 0.58));
    el.word.style.setProperty('--fs', fs.toFixed(1) + 'px');
  }
  const book = BOOKS[pos.b];
  el.ref.textContent = book.n + ' ' + (pos.c + 1) + (t.v >= 0 ? ':' + (t.v + 1) : '');
  el.bar.style.width = (100 * pos.i / Math.max(1, tokensOf(pos.b, pos.c).length - 1)) + '%';
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function renderContext() {
  const t = cur();
  body.classList.toggle('has-context', !t.h);
  if (t.h) {
    el.context.innerHTML = '';
    return;
  }
  const words = tokensOf(pos.b, pos.c).filter((x) => x.v === t.v);
  el.context.innerHTML = '<sup>' + (t.v + 1) + '</sup>' + words
    .map((x) => (x.w === t.w ? '<mark>' + escapeHtml(x.t) + '</mark>' : escapeHtml(x.t)))
    .join(' ');
}

function showPaused() {
  render();
  renderContext();
  store('pos', freeze(pos));
}

// ---------- ритм ----------

function delayFor(t) {
  const base = 60000 / wpm;
  if (t.h) return Math.max(900, base * 3);
  let d = base;
  const n = (t.t.slice(t.m[0], t.m[1]).match(/[\p{L}\p{N}]/gu) || []).length;
  // длинные слова дольше; очень длинные (от 14 букв) - заметно дольше
  if (n > 13) d *= Math.min(2.5, 1.48 + (n - 13) * 0.12);
  else if (n > 7) d *= 1 + (n - 7) * 0.08;
  if (SENT_END.test(t.t)) d *= 2.2;
  else if (/[,;:\-—]["»”')]*$/.test(t.t)) d *= 1.6;
  if (t.e) d *= 1.15;
  // каждое прицепленное служебное слово +40%, отрицание ещё +10%
  if (t.k > 1) d *= 1 + 0.4 * (t.k - 1);
  if (t.g) d *= 1.1;
  // начало предложения: после длинной паузы короткое «Он», «я» иначе мелькает
  if (t.s) d *= n <= 3 ? 1.5 : 1.25;
  return d;
}

// ---------- воспроизведение: держишь палец - идёт, отпустил - пауза ----------

let playing = false;
let timer = 0;
let wake = null;
let sleepTimer = 0;
const plugins = (window.Capacitor && window.Capacitor.Plugins) || {};

// экран не гаснет, пока читаем, и ещё минуту после паузы
async function keepAwake() {
  clearTimeout(sleepTimer);
  try {
    if (plugins.KeepAwake) await plugins.KeepAwake.keepAwake();
    else if ('wakeLock' in navigator && !wake) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    }
  } catch (e) { /* не поддерживается */ }
}

function allowSleepLater() {
  clearTimeout(sleepTimer);
  sleepTimer = setTimeout(() => {
    try {
      if (plugins.KeepAwake) plugins.KeepAwake.allowSleep();
      else if (wake) wake.release();
    } catch (e) { /* ок */ }
  }, 60000);
}

// ---------- история чтения ----------

const HISTORY_MAX = 300;
const SESSION_GAP = 30 * 60000;
let readHistory = load('history', []);
if (!Array.isArray(readHistory)) readHistory = [];
readHistory = readHistory.map(normalizeEntry).filter(Boolean);
let days = load('days', {}); // 'ГГГГ-ММ-ДД' -> {ms, words}
let readMap = load('read', {}); // 'книга.глава' -> строка из 0/1 по стихам
let session = null;

const cmpPos = (a, b) => a.b - b.b || a.c - b.c || a.v - b.v || a.o - b.o;

function normalizeEntry(e) {
  if (!e) return null;
  const start = normalize(e.start);
  const end = normalize(e.end);
  return start && end ? { ...e, start, end } : null;
}

function dateKey(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// стих прочитан, когда во время чтения показано его последнее слово
function markVerse(b, c, v) {
  const key = b + '.' + c;
  const n = BOOKS[b].c[c].length;
  let s = readMap[key];
  if (!s || s.length !== n) s = '0'.repeat(n);
  if (s[v] === '1') return;
  readMap[key] = s.slice(0, v) + '1' + s.slice(v + 1);
}

const versesIn = (b) => BOOKS[b].c.reduce((sum, ch) => sum + ch.length, 0);
const BOOK_VERSES = BOOKS.map((_, b) => versesIn(b));

function readCount(b, c) {
  const s = readMap[b + '.' + c];
  return s ? s.split('1').length - 1 : 0;
}

function bookRead(b) {
  let n = 0;
  for (let c = 0; c < BOOKS[b].c.length; c++) n += readCount(b, c);
  return n;
}

function rangeRead(from, to) {
  let read = 0;
  let total = 0;
  for (let b = from; b < to; b++) {
    read += bookRead(b);
    total += BOOK_VERSES[b];
  }
  return read / total;
}

function startSession() {
  session = { from: freeze(pos), t: Date.now(), words: 0 };
}

// продолжение рядом с прошлым местом в течение 30 минут дописывается в ту же запись
function endSession() {
  const s = session;
  session = null;
  if (!s || !s.words) return;
  const now = Date.now();
  const end = freeze(pos);
  track('read', { words: s.words, seconds: Math.round((now - s.t) / 1000), book: BOOKS[pos.b].n, wpm });
  const day = days[dateKey(now)] || { ms: 0, words: 0 };
  day.ms += now - s.t;
  day.words += s.words;
  days[dateKey(now)] = day;
  store('days', days);
  store('read', readMap);
  const last = readHistory[0];
  const near = last && now - last.t1 < SESSION_GAP
    && last.end.b === s.from.b && Math.abs(last.end.c - s.from.c) <= 1;
  if (near) {
    if (cmpPos(s.from, last.start) < 0) last.start = s.from;
    last.end = end;
    last.t1 = now;
    last.words += s.words;
    last.ms += now - s.t;
  } else {
    readHistory.unshift({ start: s.from, end, t0: s.t, t1: now, words: s.words, ms: now - s.t });
    if (readHistory.length > HISTORY_MAX) readHistory.length = HISTORY_MAX;
  }
  store('history', readHistory);
}

function play() {
  if (playing) return;
  playing = true;
  body.classList.add('playing', 'started');
  startSession();
  keepAwake();
  render();
  // текущее слово показываем чуть дольше, чтобы глаз успел поймать ритм
  const t = cur();
  timer = setTimeout(step, delayFor(t) * (t.h ? 1 : 1.5));
}

function step() {
  if (!playing) return;
  if (!advance()) {
    pause();
    return;
  }
  const t = cur();
  if (session) session.words += t.k;
  if (t.e) markVerse(pos.b, pos.c, t.v);
  render();
  timer = setTimeout(step, delayFor(cur()));
}

function pause() {
  if (!playing) return;
  playing = false;
  clearTimeout(timer);
  body.classList.remove('playing');
  endSession();
  allowSleepLater();
  showPaused();
  reloadIfIdle();
}

const pointers = new Set();

// у краёв: короткое касание - стих назад/вперёд, удержание - чтение, как везде
const TAP_MS = 220;
const TAP_MOVE = 20;
let edge = null;

function edgeSide(x) {
  const w = el.reader.clientWidth;
  const zone = Math.max(56, w * 0.2);
  return x < zone ? -1 : x > w - zone ? 1 : 0;
}

function flash(side) {
  const f = $('flash');
  f.className = side < 0 ? 'left' : 'right';
  void f.offsetWidth;
  f.classList.add('on');
}

el.reader.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.ui')) return;
  e.preventDefault();
  pointers.add(e.pointerId);
  try { el.reader.setPointerCapture(e.pointerId); } catch (err) { /* ок */ }
  const side = edgeSide(e.clientX);
  if (side && !playing && pointers.size === 1) {
    edge = { id: e.pointerId, side, x: e.clientX, y: e.clientY };
    edge.timer = setTimeout(() => { edge = null; play(); }, TAP_MS);
    return;
  }
  play();
});

el.reader.addEventListener('pointermove', (e) => {
  if (!edge || edge.id !== e.pointerId) return;
  if (Math.hypot(e.clientX - edge.x, e.clientY - edge.y) > TAP_MOVE) {
    clearTimeout(edge.timer);
    edge = null;
    play();
  }
});

function release(e) {
  if (!pointers.delete(e.pointerId)) return;
  if (edge && edge.id === e.pointerId) {
    clearTimeout(edge.timer);
    const side = edge.side;
    edge = null;
    if (!playing && e.type === 'pointerup') {
      if (side < 0) prevVerse();
      else nextVerse();
      flash(side);
    }
  }
  if (!pointers.size) pause();
}

el.reader.addEventListener('pointerup', release);
el.reader.addEventListener('pointercancel', release);
el.reader.addEventListener('lostpointercapture', release);
document.addEventListener('contextmenu', (e) => e.preventDefault());

// на компьютере: держать пробел
document.addEventListener('keydown', (e) => {
  if (!el.menu.hidden) {
    if (e.key === 'Escape') closeMenu();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) play();
  } else if (!playing && e.key === 'ArrowLeft') prevVerse();
  else if (!playing && e.key === 'ArrowRight') nextVerse();
  else if (e.key === '+' || e.key === '=') changeWpm(1);
  else if (e.key === '-') changeWpm(-1);
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') pause();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pointers.clear();
    pause();
    store('pos', freeze(pos));
  }
});

// ---------- скорость ----------

function changeWpm(dir) {
  const stepSize = (dir > 0 ? wpm >= 500 : wpm > 500) ? 50 : 25;
  wpm = Math.min(WPM_MAX, Math.max(WPM_MIN, wpm + dir * stepSize));
  el.wpm.textContent = wpm;
  store('wpm', wpm);
}

$('slower').addEventListener('click', () => changeWpm(-1));
$('faster').addEventListener('click', () => changeWpm(1));
$('prev').addEventListener('click', prevVerse);
$('next').addEventListener('click', nextVerse);

// ---------- меню книг и глав ----------

let tab = pos.b < OT ? 'ot' : 'nt';

function openMenu() {
  pause();
  tab = pos.b < OT ? 'ot' : 'nt';
  showMenuTab();
  el.menu.hidden = false;
}

function closeMenu() {
  el.menu.hidden = true;
  reloadIfIdle();
}

function percent(x) {
  const p = x * 100;
  if (p > 0 && p < 1) return '<1%';
  return (p >= 99.95 ? 100 : Math.floor(p * 10) / 10).toLocaleString('ru-RU') + '%';
}

// заливка кнопки по доле прочитанного
function fill(btn, x) {
  if (x > 0) btn.style.setProperty('--done', (x * 100).toFixed(1) + '%');
  if (x >= 0.999) btn.classList.add('done');
}

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// вложенный экран меню (главы книги, справка): слева «‹ назад», вкладки скрыты
function subScreen(backLabel) {
  el.menuBack.textContent = '‹ ' + backLabel;
  el.menuBack.hidden = false;
  $('menu-help').hidden = true;
  el.tabs.hidden = true;
}

function showMenuTab() {
  el.menuBack.hidden = true;
  $('menu-help').hidden = false;
  el.tabs.hidden = false;
  el.tabs.querySelectorAll('button').forEach((btn) => btn.classList.toggle('on', btn.dataset.tab === tab));
  if (tab === 'hist') showHistory();
  else showBooks();
}

function showBooks() {
  el.menuTitle.textContent = 'Книги';
  const from = tab === 'ot' ? 0 : OT;
  const to = tab === 'ot' ? OT : BOOKS.length;
  const summary = node('p', 'summary',
    (tab === 'ot' ? 'Ветхий Завет' : 'Новый Завет') + ': прочитано ' + percent(rangeRead(from, to))
    + ' · вся Библия: ' + percent(rangeRead(0, BOOKS.length)));
  const grid = node('div', 'books');
  for (let b = from; b < to; b++) {
    const btn = node('button');
    btn.type = 'button';
    const x = bookRead(b) / BOOK_VERSES[b];
    btn.append(node('span', '', BOOKS[b].n));
    if (x > 0) btn.append(node('small', '', percent(x)));
    fill(btn, x);
    if (b === pos.b) btn.classList.add('cur');
    btn.addEventListener('click', () => {
      if (BOOKS[b].c.length === 1) goTo({ b, c: 0, i: 0 });
      else showChapters(b);
    });
    grid.appendChild(btn);
  }
  el.menuList.replaceChildren(summary, grid);
  const current = grid.querySelector('.cur');
  if (current) current.scrollIntoView({ block: 'center' });
  else el.menuList.scrollTop = 0;
}

function showChapters(b) {
  el.menuTitle.textContent = BOOKS[b].n;
  subScreen('Книги');
  const summary = node('p', 'summary', 'Прочитано ' + percent(bookRead(b) / BOOK_VERSES[b]));
  const grid = node('div', 'chapters');
  BOOKS[b].c.forEach((verses, c) => {
    const btn = node('button', '', c + 1);
    btn.type = 'button';
    fill(btn, readCount(b, c) / verses.length);
    if (b === pos.b && c === pos.c) btn.classList.add('cur');
    btn.addEventListener('click', () => goTo({ b, c, i: 0 }));
    grid.appendChild(btn);
  });
  el.menuList.replaceChildren(summary, grid);
  el.menuList.scrollTop = 0;
}

function goTo(p) {
  pos = resolve(p) || pos;
  closeMenu();
  showPaused();
}

// ---------- история и статистика ----------

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const words = (n) => n.toLocaleString('ru-RU') + ' ' + plural(n, 'слово', 'слова', 'слов');

function duration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return '<1 мин';
  if (min < 60) return min + ' мин';
  return Math.floor(min / 60) + ' ч ' + (min % 60) + ' мин';
}

const verseOf = (p) => Math.max(0, p.v);

const placeText = (p) => BOOKS[p.b].n + ' ' + (p.c + 1) + ':' + (verseOf(p) + 1);

function fromText(a, z) {
  if (a.b !== z.b) return 'с ' + placeText(a);
  if (a.c !== z.c) return 'с ' + (a.c + 1) + ':' + (verseOf(a) + 1);
  return 'со стиха ' + (verseOf(a) + 1);
}

function dayLabel(key) {
  const now = Date.now();
  if (key === dateKey(now)) return 'Сегодня';
  if (key === dateKey(now - 86400000)) return 'Вчера';
  const [y, m, d] = key.split('-').map(Number);
  const opts = { day: 'numeric', month: 'long' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', opts);
}

function streak() {
  let t = Date.now();
  if (!days[dateKey(t)]) t -= 86400000;
  let n = 0;
  while (days[dateKey(t)]) {
    n++;
    t -= 86400000;
  }
  return n;
}

function stat(label, value) {
  const box = node('div', 'stat');
  box.append(node('b', '', value), node('span', '', label));
  return box;
}

function showHistory() {
  el.menuTitle.textContent = 'История';
  const now = Date.now();
  const today = days[dateKey(now)] || { ms: 0, words: 0 };
  let week = 0;
  let weekWords = 0;
  for (let k = 0; k < 7; k++) {
    const d = days[dateKey(now - k * 86400000)];
    if (d) {
      week += d.ms;
      weekWords += d.words;
    }
  }
  const s = streak();
  const stats = node('div', 'stats');
  stats.append(
    stat('сегодня · ' + words(today.words), duration(today.ms)),
    stat('за 7 дней · ' + words(weekWords), duration(week)),
    stat(plural(s, 'день подряд', 'дня подряд', 'дней подряд'), String(s)),
    stat('Библии прочитано', percent(rangeRead(0, BOOKS.length))),
  );

  const list = node('div', 'history');
  if (!readHistory.length) list.append(node('p', 'summary', 'Здесь появятся места, где вы остановились.'));
  let lastDay = '';
  for (const e of readHistory) {
    const key = dateKey(e.t1);
    if (key !== lastDay) {
      list.append(node('h3', '', dayLabel(key)));
      lastDay = key;
    }
    const btn = node('button');
    btn.type = 'button';
    const time = new Date(e.t1).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    btn.append(
      node('span', '', placeText(e.end)),
      node('small', '', [fromText(e.start, e.end), time, duration(e.ms), words(e.words)].join(' · ')),
    );
    btn.addEventListener('click', () => goTo(e.end));
    list.append(btn);
  }

  const tools = node('div', 'tools');
  const exp = node('button', '', 'Сохранить прогресс в файл');
  const imp = node('button', '', 'Загрузить прогресс из файла');
  exp.type = imp.type = 'button';
  exp.addEventListener('click', exportProgress);
  imp.addEventListener('click', () => $('import-file').click());
  tools.append(exp, imp, node('p', 'summary',
    'Файл пригодится при переустановке приложения или смене телефона.'),
  node('p', 'summary', versionLine()));

  el.menuList.replaceChildren(stats, list, tools);
  el.menuList.scrollTop = 0;
}

// ---------- сохранение прогресса в файл ----------

function progressData() {
  return { app: 'bible-speedread', version: 1, exported: new Date().toISOString(), pos: freeze(pos), wpm, history: readHistory, days, read: readMap };
}

async function exportProgress() {
  const json = JSON.stringify(progressData());
  const name = 'bible-speedread-' + dateKey(Date.now()) + '.json';
  try {
    if (plugins.Filesystem && plugins.Share) {
      const file = await plugins.Filesystem.writeFile({ path: name, data: json, directory: 'CACHE', encoding: 'utf8' });
      await plugins.Share.share({ title: 'Прогресс чтения', files: [file.uri] });
    } else {
      // веб-версия: на телефоне (iPhone) - меню «Поделиться», на компьютере - скачивание
      const file = new File([json], name, { type: 'application/json' });
      const touch = window.matchMedia('(pointer: coarse)').matches;
      if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Прогресс чтения' });
      } else {
        const a = node('a');
        a.href = URL.createObjectURL(file);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    }
  } catch (e) {
    const cancelled = e && (e.name === 'AbortError' || /cancel/i.test(String(e.message)));
    if (!cancelled) alert('Не получилось сохранить файл: ' + (e && e.message));
  }
}

function mergeProgress(data) {
  for (const [key, s] of Object.entries(data.read || {})) {
    const mine = readMap[key];
    if (typeof s !== 'string') continue;
    if (!mine || mine.length !== s.length) readMap[key] = s;
    else readMap[key] = [...s].map((ch, i) => (ch === '1' || mine[i] === '1' ? '1' : '0')).join('');
  }
  for (const [key, d] of Object.entries(data.days || {})) {
    const mine = days[key] || { ms: 0, words: 0 };
    days[key] = { ms: Math.max(mine.ms, d.ms || 0), words: Math.max(mine.words, d.words || 0) };
  }
  const seen = new Set(readHistory.map((e) => e.t0));
  for (const e of (data.history || []).map(normalizeEntry)) if (e && !seen.has(e.t0)) readHistory.push(e);
  readHistory.sort((a, b) => b.t1 - a.t1);
  if (readHistory.length > HISTORY_MAX) readHistory.length = HISTORY_MAX;
  pos = resolve(data.pos) || pos;
  if (data.wpm >= WPM_MIN && data.wpm <= WPM_MAX) wpm = data.wpm;
  store('read', readMap);
  store('days', days);
  store('history', readHistory);
  store('pos', freeze(pos));
  store('wpm', wpm);
  el.wpm.textContent = wpm;
}

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'bible-speedread') throw new Error('это не файл прогресса');
    const when = new Date(data.exported).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    if (!confirm('Загрузить прогресс от ' + when + '? Он объединится с текущим, место чтения возьмётся из файла.')) return;
    mergeProgress(data);
    showPaused();
    showHistory();
  } catch (err) {
    alert('Не получилось загрузить файл: ' + err.message);
  }
});

// ---------- справка ----------

// страница о проекте: описание, установка, связь, конфиденциальность (папка about/, выкладывает publish.py)
const ABOUT_URL = 'https://artem-krotkov.github.io/bible-speedread/about/';

const HELP = [
  ['Как читать', [
    'Держите палец на экране - слова идут. Отпустили - пауза.',
    'Смотрите на красную букву: она всегда в одной точке, глаза не двигаются.',
    'На паузе внизу виден весь стих, текущее слово подчёркнуто.',
  ]],
  ['Переходы', [
    'Короткое касание у левого края - стих назад, у правого - вперёд.',
    'Кнопки «‹ стих» и «стих ›» внизу делают то же самое.',
    'Касание названия книги вверху - выбор книги и главы.',
  ]],
  ['Скорость', [
    'Кнопки − и + на паузе, от 100 до 1000 слов в минуту.',
    'Начните с 250-300. Если смысл ускользает - убавьте.',
    'Длинные слова, знаки препинания и конец стиха показываются дольше.',
    'Короткие слова («и», «не», «в», «ли») идут вместе с соседним словом, чтобы не проскакивать.',
  ]],
  ['История и прогресс', [
    'Меню → История: где вы остановились, сколько прочитали и за какое время. Касание записи - вернуться туда.',
    'Стих считается прочитанным, когда вы дошли до его конца. У книг виден процент, главы закрашиваются.',
    'Перед переустановкой или сменой телефона нажмите «Сохранить прогресс в файл», потом на новом месте - «Загрузить прогресс из файла».',
  ]],
  ['О тексте', [
    'Синодальный перевод (1876), 66 канонических книг.',
    'Слова, которые в печатном издании стоят в квадратных скобках, показаны без скобок.',
  ]],
];

function showHelp() {
  el.menuTitle.textContent = 'Справка';
  subScreen('Назад');
  const box = node('div', 'help');
  for (const [title, lines] of HELP) {
    const ul = node('ul');
    for (const line of lines) ul.append(node('li', '', line));
    box.append(node('h3', '', title), ul);
  }
  const tools = node('div', 'tools');
  const about = node('button', '', 'О проекте');
  about.type = 'button';
  about.addEventListener('click', () => {
    track('about_open');
    location.href = ABOUT_URL; // в Android внешний адрес Capacitor открывает в браузере
  });
  tools.append(about);
  box.append(tools, node('p', 'summary', versionLine()));
  el.menuList.replaceChildren(box);
  el.menuList.scrollTop = 0;
}

function openHelp() {
  pause();
  tab = pos.b < OT ? 'ot' : 'nt';
  showHelp();
  el.menu.hidden = false;
}

el.ref.addEventListener('click', openMenu);
$('menu-help').addEventListener('click', showHelp);
$('menu-close').addEventListener('click', closeMenu);
el.menuBack.addEventListener('click', showMenuTab);
el.tabs.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  tab = btn.dataset.tab;
  showMenuTab();
});

// ---------- запуск ----------

window.addEventListener('resize', () => { measure(); render(); });
measure();
el.wpm.textContent = wpm;
showPaused();
// новая веб-часть запустилась - иначе через 10 с модуль обновлений вернёт прежнюю
if (plugins.CapacitorUpdater) plugins.CapacitorUpdater.notifyAppReady().catch(() => { /* ок */ });

// веб-версия: работа без интернета и автообновление (в сборке Android не нужна).
// Новая версия ставится в фоне; страницу перезагружаем, когда не читают и меню закрыто - место сохранено
let reloadWhenIdle = false;

function reloadIfIdle() {
  if (reloadWhenIdle && !playing && el.menu.hidden) location.reload();
}

if ('serviceWorker' in navigator && !window.Capacitor && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // первая установка - страница и так свежая
    reloadWhenIdle = true;
    reloadIfIdle();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // с экрана Домой приложение часто не запускается заново, а возвращается из фона - проверяем и тогда
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update().catch(() => { /* нет сети */ });
    });
  }).catch(() => { /* без офлайна */ });
}

// iPhone в Safari (не с экрана Домой): подсказать установку
const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
if (isIos && !standalone && !window.Capacitor) $('install').hidden = false;

// ---------- статистика (Google Analytics 4) ----------
// Анонимный номер устройства храним сами (rsvp.device) и передаём как client_id - так он не зависит от cookies GA.
// Пустой GA_ID - статистика выключена.

const GA_ID = 'G-YM6LX4Q5TX';
const PLATFORM = window.Capacitor ? 'android_apk'
  : isIos ? (standalone ? 'iphone_app' : 'iphone_safari')
  : standalone ? 'web_app' : 'browser';
// «0.1.8 22.10.2026» - номер сборки и дата (у веба - дата публикации)
const VERSION = (window.APP_VERSION || '').replace(' от ', ' ').replace(/ \d\d:\d\d$/, '');

function deviceId() {
  let id = load('device', null);
  if (!id) {
    id = Math.floor(Math.random() * 2e9) + '.' + Math.floor(Date.now() / 1000);
    store('device', id);
  }
  return id;
}

function track(name, params) {
  if (window.gtag) window.gtag('event', name, params);
}

if (GA_ID) {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('set', 'user_properties', { platform: PLATFORM, app_version: VERSION });
  window.gtag('config', GA_ID, {
    client_id: deviceId(),
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.append(s);
}

// ---------- обновления Android-приложения (не из магазина) ----------
// android.json на сайте (пишет publish.py): code/name/url/notes - последний APK;
// web - последняя веб-часть: номер, минимальный APK (min_native), файлы с отпечатками SHA-256.
// Веб-часть (код, тексты, ритм) обновляется тихо: модуль Capgo качает только изменённые файлы
// (остальные, например текст Библии, берёт из APK или прошлых обновлений), включает новую версию,
// когда приложение свёрнуто или перезапущено, а если она не запустилась - возвращает прежнюю.
// Новый APK (иконка, модули телефона) - через окно «Обновить»: браузер, затем установщик Android.

const UPDATE_URL = 'https://artem-krotkov.github.io/bible-speedread/android.json';
// тексты согласованы 22.10.2026; строку «что нового» (notes) пишет publish.py
const UPDATE_TEXT = {
  title: 'Вышла версия {N}',
  go: 'Обновить',
  later: 'Позже',
  after: 'Скачивается новая версия. Когда загрузится - откройте файл и нажмите «Обновить» (если Android спросит разрешение на установку - разрешите). Место чтения и история сохранятся.',
};
const updater = plugins.CapacitorUpdater;
let native = null; // {build: номер APK, version: '0.1.N'}
let updateLater = false;
let checking = false;
let webReady = 0;

// «Версия 0.1.12 от 22.10.2026 17:00 · приложение 0.1.10» (вторая часть - если APK старше веб-части)
function versionLine() {
  let s = 'Версия ' + (window.APP_VERSION || 'без номера');
  if (native && native.version && !String(window.APP_VERSION).startsWith(native.version + ' ')) s += ' · приложение ' + native.version;
  return s;
}

async function nativeInfo() {
  if (native || !plugins.App) return native;
  const i = await plugins.App.getInfo();
  native = { build: Number(i.build) || 0, version: i.version };
  if (window.gtag) window.gtag('set', 'user_properties', { apk_version: native.version });
  return native;
}

async function checkUpdate() {
  if (!window.Capacitor || checking) return;
  checking = true;
  try {
    const n = await nativeInfo();
    if (!n) return;
    const r = await fetch(UPDATE_URL + '?t=' + Date.now(), { cache: 'no-store' });
    const u = await r.json();
    if (u.code > n.build && u.url && !updateLater && $('update').hidden) showUpdate(u);
    const w = u.web;
    if (updater && w && w.code > (window.APP_WEB || 0) && n.build >= w.min_native && webReady !== w.code) {
      const { bundles } = await updater.list();
      let b = bundles.find((x) => x.version === w.name && x.status === 'success');
      if (!b) b = await updater.download({ url: UPDATE_URL, version: w.name, manifest: w.manifest });
      await updater.next({ id: b.id });
      webReady = w.code;
      track('web_update_ready', { to: w.name });
    }
  } catch (e) {
    /* нет сети или не скачалось - в другой раз */
  } finally {
    checking = false;
  }
}

function showUpdate(u) {
  const text = $('update-text');
  text.replaceChildren(node('b', '', UPDATE_TEXT.title.replace('{N}', u.name)));
  if (u.notes) text.append(document.createElement('br'), u.notes);
  $('update-go').textContent = UPDATE_TEXT.go;
  $('update-later').textContent = UPDATE_TEXT.later;
  $('update-buttons').hidden = false;
  $('update').hidden = false;
  body.classList.add('has-update');
  $('update-go').onclick = () => {
    track('update_click', { to: u.name });
    $('update-buttons').hidden = true;
    text.textContent = UPDATE_TEXT.after;
    location.href = u.url; // внешний адрес Capacitor открывает в браузере
  };
  $('update-later').onclick = () => {
    updateLater = true;
    $('update').hidden = true;
    body.classList.remove('has-update');
  };
  track('update_offer', { to: u.name });
}

checkUpdate();
if (plugins.App) plugins.App.addListener('resume', checkUpdate);

// при первом запуске справка открывается сама
if (!load('helpSeen', false)) {
  store('helpSeen', true);
  openHelp();
}

// кнопка «назад» Android: сначала закрыть меню, иначе свернуть приложение
if (plugins.App) {
  plugins.App.addListener('backButton', () => {
    if (!el.menu.hidden) {
      if (!el.menuBack.hidden) showMenuTab();
      else closeMenu();
    } else {
      plugins.App.minimizeApp();
    }
  });
}
