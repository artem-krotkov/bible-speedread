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
  wl: $('wl'), wp: $('wp'), wr: $('wr'), context: $('context'), verse: $('verse'), vt: $('vt'), strip: $('wordstrip'), sl: $('sl'), sp: $('sp'), sr: $('sr'),
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
// ритм 2 (с 0.1.13): число в настройке = реальная скорость. При ритме 1 реальная была ~0,88 от числа,
// поэтому сохранённую раньше скорость один раз пересчитываем - чтение ощущается так же, как до обновления
const RHYTHM = 2;
const roundSpeed = (w) => Math.min(WPM_MAX, Math.max(WPM_MIN, w < 500 ? Math.round(w / 25) * 25 : Math.round(w / 50) * 50));
const fromRhythm1 = (w) => roundSpeed(w * 0.88);
let wpm = load('wpm', null);
if (wpm != null && load('rhythm', 1) < RHYTHM) {
  wpm = fromRhythm1(wpm);
  store('wpm', wpm);
}
store('rhythm', RHYTHM);
wpm = roundSpeed(wpm ?? 275);

const cur = () => tokensOf(pos.b, pos.c)[pos.i];

// ---------- показ: по словам или стихом ----------
// Настройки → Показ. По словам - RSVP, слова по одному. Стихом - стих (или его часть, если стих длинный) целиком:
// сам сменяется через время, равное сумме показов его слов, либо только касанием у края (verse-manual).
// Тексты - на согласовании (04.11.2026).
const VIEWS = [
  ['words', 'По словам', 'Слова идут по одному в одной точке.'],
  ['verse', 'Стихом', 'Стих показан целиком и сам сменяется. Длинный стих делится на части.'],
  ['verse-manual', 'Стихом, листать касанием', 'Стих показан целиком и не сменяется сам - только касанием у левого или правого края.'],
];
let view = VIEWS.find((x) => x[0] === load('view', 'words')) || VIEWS[0];
const viewVerse = () => view[0] !== 'words';
// какой из двух показов стихом включать при переключении «слова ↔ стих» (запоминается)
let lastVerseView = VIEWS.find((x) => x[0] === load('viewVerse', null) && x[0] !== 'words') || (viewVerse() ? view : VIEWS[1]);
const viewManual = () => view[0] === 'verse-manual';

// экраны главы: заголовок, затем стих целиком или его части {i0, i1 - показы, v, first, last, h}.
// Деление зависит от размера экрана и шрифта (меряется в #verse), поэтому кэш сбрасывается в measure()
const screenCache = new Map();
const CLAUSE_END = /[,;:.!?…—]["»”')]*$/;

// слова ↔ стих на лету: свайп вверх/вниз, касание стиха внизу (по словам), строка со словом внизу (стихом).
// Из стиха в слова - с первого слова экрана (pos.i в режиме стиха всегда начало экрана)
function setView(x) {
  pause();
  endManual();
  view = x;
  store('view', x[0]);
  if (x[0] !== 'words') {
    lastVerseView = x;
    store('viewVerse', x[0]);
  }
  screenCache.clear();
  render();
  if (viewVerse()) {
    pos.i = curScreen().i0;
    render();
  }
  showHint();
  renderContext();
  store('pos', freeze(pos));
}

const toggleView = () => setView(viewVerse() ? VIEWS[0] : lastVerseView);

function verseFits(list, v, a, z) {
  el.vt.innerHTML = '<sup>' + (v + 1) + '</sup>' + escapeHtml(list.slice(a, z + 1).map((x) => x.t).join(' '));
  return el.vt.offsetHeight <= el.verse.clientHeight - 6;
}

// части стиха: сначала целиком, иначе на n частей примерно равной длины (n = 2, 3, ...), границы - у знаков препинания
function splitVerse(list, i, j) {
  const v = list[i].v;
  if (i === j || verseFits(list, v, i, j)) return [[i, j]];
  const cum = [];
  let sum = 0;
  for (let q = i; q <= j; q++) {
    sum += list[q].t.length + 1;
    cum.push(sum);
  }
  // начинаем с оценки по высоте целого стиха (у самых длинных в Есфири 4:17 - 576 слов - десятки частей)
  const first = Math.max(2, Math.floor(el.vt.offsetHeight / Math.max(1, el.verse.clientHeight)));
  let parts = [];
  for (let n = first; n <= 120; n++) {
    parts = [];
    let from = i;
    for (let k = 1; k < n; k++) {
      const ideal = (sum * k) / n;
      let best = -1;
      let bestScore = Infinity;
      for (let q = from; q <= j - (n - k); q++) {
        const score = Math.abs(cum[q - i] - ideal) * (CLAUSE_END.test(list[q].t) ? 1 : 2.5);
        if (score < bestScore) {
          bestScore = score;
          best = q;
        }
      }
      if (best < from) break;
      parts.push([from, best]);
      from = best + 1;
    }
    parts.push([from, j]);
    if (parts.length === n && parts.every(([a, z]) => verseFits(list, v, a, z))) return parts;
  }
  return parts;
}

function screensOf(b, c) {
  const key = b + ':' + c;
  if (screenCache.has(key)) return screenCache.get(key);
  const list = tokensOf(b, c);
  const out = [{ i0: 0, i1: 0, h: true, v: -1 }];
  let i = 1;
  while (i < list.length) {
    let j = i;
    while (j + 1 < list.length && list[j + 1].v === list[i].v) j++;
    for (const [a, z] of splitVerse(list, i, j)) out.push({ i0: a, i1: z, h: false, v: list[i].v, first: a === i, last: z === j });
    i = j + 1;
  }
  if (screenCache.size > 6) screenCache.delete(screenCache.keys().next().value);
  screenCache.set(key, out);
  return out;
}

function screenIndex() {
  const k = screensOf(pos.b, pos.c).findIndex((s) => pos.i >= s.i0 && pos.i <= s.i1);
  return k < 0 ? 0 : k;
}
const curScreen = () => screensOf(pos.b, pos.c)[screenIndex()];
const wordsOnScreen = (s) => tokensOf(pos.b, pos.c).slice(s.i0, s.i1 + 1).reduce((n, t) => n + t.k, 0);

// сколько держать экран: сумма показов его слов, не меньше 1,5 с (глазу нужно пройти строки)
function screenDelay(s) {
  const list = tokensOf(pos.b, pos.c);
  let d = 0;
  for (let k = s.i0; k <= s.i1; k++) d += delayFor(list[k]);
  return s.h ? d : Math.max(1500, d);
}

// ставит pos на соседний экран (в том числе в соседней главе); false - дальше некуда
function moveScreen(dir) {
  const list = screensOf(pos.b, pos.c);
  const k = screenIndex();
  if (list[k + dir]) {
    pos.i = list[k + dir].i0;
    return true;
  }
  if (dir > 0) {
    const n = nextChapter(pos);
    if (!n) return false;
    pos = { ...n, i: 0 };
  } else {
    const p = prevChapter(pos);
    if (!p) return false;
    const prev = screensOf(p.b, p.c);
    pos = { ...p, i: prev[prev.length - 1].i0 };
  }
  return true;
}

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
  if (viewVerse()) return moveScreen(1);
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
  if (viewVerse()) {
    moveScreen(-1);
    showPaused();
    return;
  }
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

// при показе стихом ход вперёд касанием считается чтением (в ручном режиме это единственный способ читать,
// в автоматическом - чтение «держал, отпустил, листаю краем»); при показе по словам это только переход
function nextVerse() {
  if (viewVerse()) {
    const reading = !playing;
    if (reading && !session) startSession();
    if (!moveScreen(1)) return;
    if (reading) countScreen();
    showPaused();
    return;
  }
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

// ---------- шрифт и размер слова ----------

// шрифты на выбор (Настройки → Шрифт): код, название, CSS font-family
const FONTS = [
  ['system', 'Обычный', 'Roboto, "Segoe UI", system-ui, sans-serif'],
  ['condensed', 'Roboto Condensed', '"Roboto Condensed", Roboto, system-ui, sans-serif'],
  ['literata', 'Literata', 'Literata, Georgia, serif'],
];
let font = FONTS.find((f) => f[0] === load('font', 'system')) || FONTS[0];
const ctx = document.createElement('canvas').getContext('2d');

function textWidth(s, fs) {
  ctx.font = fs + 'px ' + font[2];
  return ctx.measureText(s).width;
}

// размер слова постоянный, чтобы не скакал: по обе стороны от красной буквы влезает FIT_CHARS знаков
// средней ширины (99,9% показов); длиннее - только 1 показ из 1000, его уменьшаем
const FIT_CHARS = 10.5;
const SAMPLE = 'и сказал Бог: да будет свет. и стал свет, и увидел Бог свет, что он хорош';
let baseFs = 44;

function measure() {
  screenCache.clear();
  const w = el.word.clientWidth || window.innerWidth - 32;
  const charW = textWidth(SAMPLE, 100) / 100 / SAMPLE.length;
  baseFs = Math.min(60, (w / 2) * 0.96 / (FIT_CHARS * charW));
  el.word.style.setProperty('--line', Math.ceil(baseFs * 1.3) + 'px');
}

function applyFont(f) {
  font = f;
  document.documentElement.style.setProperty('--read-font', f[2]);
  measure();
  render();
  // свой шрифт грузится не сразу - пересчитать размер, когда загрузится
  if (document.fonts) document.fonts.load('40px ' + f[2], SAMPLE).then(() => { if (font === f) { measure(); render(); } }, () => {});
}

function renderVerse() {
  const s = curScreen();
  el.verse.classList.toggle('heading', s.h);
  if (s.h) {
    const w = el.verse.clientWidth || window.innerWidth - 32;
    const title = cur().t;
    el.vt.textContent = title;
    el.vt.style.fontSize = Math.min(30, 30 * w * 0.96 / textWidth(title, 30)).toFixed(1) + 'px';
  } else {
    el.vt.style.fontSize = '';
    verseFits(tokensOf(pos.b, pos.c), s.v, s.i0, s.i1);
  }
  renderStrip();
}

// размер слова, чтобы оно влезло по обе стороны от красной буквы в ширину w
function fitFs(t, w, base) {
  const p = pivotOf(t);
  const room = (w - textWidth(t.t[p] || '', base)) / 2 * 0.98;
  const need = Math.max(textWidth(t.t.slice(0, p), base), textWidth(t.t.slice(p + 1), base));
  return need > room ? base * room / need : base;
}

// строка внизу при показе стихом: первое слово экрана с красной буквой, касание - обратно по словам
function renderStrip() {
  const list = tokensOf(pos.b, pos.c);
  const s = curScreen();
  const t = list[s.h ? Math.min(1, list.length - 1) : s.i0];
  const p = pivotOf(t);
  el.sl.textContent = t.t.slice(0, p);
  el.sp.textContent = t.t[p] || '';
  el.sr.textContent = t.t.slice(p + 1);
  const w = (el.strip.clientWidth || window.innerWidth - 32) - 16;
  el.strip.style.setProperty('--fs', fitFs(t, w, Math.min(baseFs, 30)).toFixed(1) + 'px');
}

function render() {
  const t = cur();
  document.body.classList.toggle('verse-view', viewVerse());
  document.body.classList.toggle('manual', viewManual());
  if (viewVerse()) {
    renderVerse();
  } else if (t.h) {
    el.word.classList.add('heading');
    el.wl.textContent = '';
    el.wp.textContent = t.t;
    el.wr.textContent = '';
    // заголовок крупнее 30 px не бывает (style.css), а длинный («2-е Фессалоникийцам, глава 10») на узком экране уменьшаем, чтобы влез
    const w = el.word.clientWidth || window.innerWidth - 32;
    const big = Math.min(baseFs, 30);
    el.word.style.setProperty('--fs', Math.min(big, big * w * 0.96 / textWidth(t.t, big)).toFixed(1) + 'px');
  } else {
    el.word.classList.remove('heading');
    const p = pivotOf(t);
    el.wl.textContent = t.t.slice(0, p);
    el.wp.textContent = t.t[p] || '';
    el.wr.textContent = t.t.slice(p + 1);
    // размер постоянный; слово, которое не влезает по обе стороны от красной буквы, уменьшаем
    const w = el.word.clientWidth || window.innerWidth - 32;
    el.word.style.setProperty('--fs', fitFs(t, w, baseFs).toFixed(1) + 'px');
  }
  const book = BOOKS[pos.b];
  const refText = book.n + ' ' + (pos.c + 1) + (t.v >= 0 ? ':' + (t.v + 1) : '');
  $('flag').hidden = !!t.h;
  $('share').hidden = !!t.h;
  if (el.ref.textContent !== refText) {
    el.ref.textContent = refText;
    // длинное название на узком экране упирается в иконку «поделиться» - сдвигаем его влево
    el.ref.classList.remove('shift');
    if (!t.h && el.ref.getBoundingClientRect().right > $('share').getBoundingClientRect().left + 12) el.ref.classList.add('shift');
  }
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
    .map((x) => (x.w === t.w && !viewVerse() ? '<mark>' + escapeHtml(x.t) + '</mark>' : escapeHtml(x.t)))
    .join(' ');
}

function showPaused() {
  render();
  renderContext();
  store('pos', freeze(pos));
}

// ---------- ритм ----------

const RHYTHM_FLOOR = 1.43;
const RHYTHM_SCALE = 0.7675;

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
  // ритм 2: ни один показ не короче среднего ритма (иначе короткие слова «разгоняются» на фоне пауз),
  // и всё масштабировано так, чтобы по всей Библии реальная скорость совпадала с настройкой.
  // Поменяли правила выше - пересчитать RHYTHM_SCALE: node tools/rhythm_check.js
  return Math.max(d, base * RHYTHM_FLOOR) * RHYTHM_SCALE;
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
function endSession(at) {
  const s = session;
  session = null;
  if (!s || !s.words) return;
  const now = at || Date.now();
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
  endManual();
  playing = true;
  body.classList.add('playing', 'started');
  startSession();
  keepAwake();
  render();
  // текущее слово показываем чуть дольше, чтобы глаз успел поймать ритм
  if (viewVerse()) {
    timer = setTimeout(step, screenDelay(curScreen()));
    return;
  }
  const t = cur();
  timer = setTimeout(step, delayFor(t) * (t.h ? 1 : 1.5));
}

function step() {
  if (!playing) return;
  if (!advance()) {
    pause();
    return;
  }
  if (viewVerse()) {
    countScreen();
    render();
    timer = setTimeout(step, screenDelay(curScreen()));
    return;
  }
  const t = cur();
  if (session) session.words += t.k;
  if (t.e) markVerse(pos.b, pos.c, t.v);
  render();
  timer = setTimeout(step, delayFor(cur()));
}

// экран показан: считаем его слова, а стих - прочитанным, когда показана его последняя часть
function countScreen() {
  const s = curScreen();
  if (s.h) return;
  if (session) session.words += wordsOnScreen(s);
  touchManual();
  if (s.last) markVerse(pos.b, pos.c, s.v);
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

// листание касанием при показе стихом: сессия кончается после минуты без касаний (время - по последнему касанию),
// при меню, сворачивании, смене показа; запуск автосмены (play) тоже её закрывает
let manualIdle = 0;

function touchManual() {
  if (!viewVerse() || playing || !session) return;
  session.last = Date.now();
  clearTimeout(manualIdle);
  manualIdle = setTimeout(endManual, 60000);
}

function endManual() {
  clearTimeout(manualIdle);
  if (playing || !session) return;
  endSession(session.last || Date.now());
  store('pos', freeze(pos));
}

// управление (Настройки → Управление), тексты согласованы 28.10.2026:
// hold - держишь палец - идёт, отпустил - пауза; tap - касание: старт и стоп
// (режим «держать - пауза» в 0.1.15 убран 29.10.2026 - кто его выбрал, переходит на «старт и стоп»)
const MODES = [
  ['hold', 'Держать палец', 'Держите палец на экране - слова идут. Отпустили - пауза.',
    ['Держите палец на экране - слова побегут.', 'Отпустите - пауза.', 'Касание у левого или правого края - стих назад или вперёд.']],
  ['tap', 'Касание: старт и стоп', 'Коснулись - слова идут. Коснулись ещё раз - пауза.',
    ['Коснитесь экрана - слова побегут.', 'Коснитесь ещё раз - пауза.', 'Касание у левого или правого края - стих назад или вперёд.']],
];
const savedMode = load('mode', 'hold');
let mode = MODES.find((m) => m[0] === (savedMode === 'still' ? 'tap' : savedMode)) || MODES[0];

function showHint() {
  const hint = $('hint');
  hint.replaceChildren();
  const lines = viewManual()
    ? ['Касание у правого края - стих дальше.', 'Касание у левого края - стих назад.']
    : viewVerse() ? mode[3].map((l) => l.replace('слова побегут', 'стихи пойдут')) : mode[3];
  lines.forEach((line, k) => {
    if (k) hint.append(document.createElement('br'));
    hint.append(line);
  });
}

const pointers = new Set();

// у краёв: короткое касание - стих назад/вперёд, удержание - чтение (в режиме «держать палец»)
const TAP_MS = 220;
const TAP_MOVE = 20;
let edge = null;
// свайп вверх или вниз - переключает показ слова/стих (в любом режиме управления; в «держать палец» чтение успевает стартовать - свайп его останавливает)
const SWIPE_MIN = 70;
let swipe = null;

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
  swipe = pointers.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
  // стих внизу на паузе: короткое касание - показ стихом, удержание - чтение (как у краёв)
  if (!viewVerse() && !playing && pointers.size === 1 && e.target.closest('#context')) {
    edge = { id: e.pointerId, side: 0, ctx: true, x: e.clientX, y: e.clientY };
    if (mode[0] === 'hold') edge.timer = setTimeout(() => { edge = null; play(); }, TAP_MS);
    return;
  }
  if (viewManual()) {
    // стих листается только касанием у края; середина экрана ничего не делает
    if (side && pointers.size === 1) edge = { id: e.pointerId, side, x: e.clientX, y: e.clientY };
    return;
  }
  if (mode[0] === 'tap') {
    if (pointers.size > 1) return;
    if (playing) pause();
    else if (side) edge = { id: e.pointerId, side, x: e.clientX, y: e.clientY };
    else play();
    return;
  }
  if (side && !playing && pointers.size === 1) {
    edge = { id: e.pointerId, side, x: e.clientX, y: e.clientY };
    edge.timer = setTimeout(() => { edge = null; play(); }, TAP_MS);
    return;
  }
  play();
});

el.reader.addEventListener('pointermove', (e) => {
  if (swipe && swipe.id === e.pointerId) {
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    if (Math.abs(dy) > SWIPE_MIN && Math.abs(dy) > 1.8 * Math.abs(dx)) {
      swipe = null;
      if (edge) clearTimeout(edge.timer);
      edge = null;
      toggleView(); // свайп вверх или вниз - переключает слова/стих
      return;
    }
  }
  if (!edge || edge.id !== e.pointerId) return;
  if (Math.hypot(e.clientX - edge.x, e.clientY - edge.y) > TAP_MOVE) {
    clearTimeout(edge.timer);
    edge = null;
    if (mode[0] === 'hold' && !viewManual()) play();
  }
});

function release(e) {
  if (!pointers.delete(e.pointerId)) return;
  if (swipe && swipe.id === e.pointerId) swipe = null;
  if (edge && edge.id === e.pointerId) {
    clearTimeout(edge.timer);
    const { side, ctx } = edge;
    edge = null;
    if (!playing && e.type === 'pointerup') {
      if (ctx) {
        toggleView();
        return;
      }
      if (side < 0) prevVerse();
      else nextVerse();
      flash(side);
    }
  }
  if (mode[0] === 'hold' && !pointers.size) pause();
}

el.reader.addEventListener('pointerup', release);
el.reader.addEventListener('pointercancel', release);
el.reader.addEventListener('lostpointercapture', release);
// в полях отзыва меню (вставить, выделить) нужно
document.addEventListener('contextmenu', (e) => { if (!e.target.closest('textarea, input')) e.preventDefault(); });

// на компьютере: держать пробел
document.addEventListener('keydown', (e) => {
  if (!el.menu.hidden) {
    if (e.key === 'Escape') closeMenu();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (e.repeat || viewManual()) return;
    if (mode[0] === 'hold' || !playing) play();
    else pause();
  } else if (!playing && e.key === 'ArrowLeft') prevVerse();
  else if (!playing && e.key === 'ArrowRight') nextVerse();
  else if (e.key === '+' || e.key === '=') changeWpm(1);
  else if (e.key === '-') changeWpm(-1);
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && mode[0] === 'hold') pause();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pointers.clear();
    pause();
    endManual();
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
el.strip.addEventListener('click', () => { if (!playing) toggleView(); });
$('prev').addEventListener('click', prevVerse);
$('next').addEventListener('click', nextVerse);

// ---------- меню книг и глав ----------

let tab = pos.b < OT ? 'ot' : 'nt';

function openMenu() {
  pause();
  endManual();
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

// кнопки «?» и ⚙ в шапке меню - только на вкладках
function menuIcons(show) {
  $('menu-help').hidden = !show;
  $('menu-settings').hidden = !show;
}

// вложенный экран меню (главы книги, справка): слева «‹ назад», вкладки скрыты
function subScreen(backLabel) {
  el.menuBack.textContent = '‹ ' + backLabel;
  el.menuBack.hidden = false;
  menuIcons(false);
  el.tabs.hidden = true;
}

function showMenuTab() {
  el.menuBack.hidden = true;
  menuIcons(true);
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

// ---------- график «слов по дням» ----------
// Самодостаточная функция: можно копировать в другое приложение вместе с блоком .dchart из style.css.
// days - {'ГГГГ-ММ-ДД': {ms, words}}; opts - {dateKey(ms) -> 'ГГГГ-ММ-ДД', words(n) -> '1 240 слов', duration(ms) -> '25 мин', count = 60}.
// Возвращает DOM-элемент: 60 столбцов (слева старый день, справа сегодня), единый масштаб по максимуму,
// касание / клик / протяжка по графику выбирает день и показывает его в строке под графиком.
function dayChart(days, opts) {
  const count = opts.count || 60;
  const num = (n) => n.toLocaleString('ru-RU');
  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const box = make('div', 'dchart');

  // последние count календарных дней, включая сегодня (середина дня - чтобы не спотыкаться о смену времени)
  const base = new Date();
  const list = [];
  for (let k = count - 1; k >= 0; k--) {
    const key = opts.dateKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() - k, 12).getTime());
    const d = days[key];
    list.push({ key, words: d && d.words > 0 ? d.words : 0, ms: d && d.ms > 0 ? d.ms : 0 });
  }
  const total = list.reduce((sum, d) => sum + d.words, 0);
  if (!total) {
    box.append(make('p', 'dchart-empty', 'График появится после первого чтения'));
    return box;
  }
  const max = Math.max(...list.map((d) => d.words));
  const active = list.filter((d) => d.words > 0).length;

  const head = make('div', 'dchart-head');
  head.append(make('span', 'dchart-title', 'Слов по дням, ' + count + ' дней'), make('span', 'dchart-max', 'макс. ' + num(max)));

  const bars = make('div', 'dchart-bars');
  const info = make('p', 'dchart-info');
  info.setAttribute('aria-live', 'polite');
  const cols = list.map((d) => {
    const col = make('div', 'dchart-col');
    const bar = make('i', d.words ? 'dchart-bar' : 'dchart-bar zero');
    if (d.words) bar.style.height = (d.words / max * 100).toFixed(2) + '%';
    col.append(bar);
    bars.append(col);
    return col;
  });

  const dateText = (key) => {
    const [y, m, dd] = key.split('-').map(Number);
    const o = { day: 'numeric', month: 'long' };
    if (y !== base.getFullYear()) o.year = 'numeric';
    return new Date(y, m - 1, dd).toLocaleDateString('ru-RU', o);
  };
  let current = -1;
  const select = (i) => {
    i = Math.max(0, Math.min(count - 1, i));
    if (i === current) return;
    if (current >= 0) cols[current].classList.remove('on');
    current = i;
    cols[i].classList.add('on');
    const d = list[i];
    info.textContent = d.words
      ? dateText(d.key) + ' · ' + opts.words(d.words) + ' · ' + opts.duration(d.ms)
      : dateText(d.key) + ' · не читали';
  };
  // протяжка пальцем по горизонтали выбирает дни, вертикаль остаётся прокруткой списка (touch-action: pan-y)
  const pick = (e) => {
    const r = bars.getBoundingClientRect();
    select(Math.floor((e.clientX - r.left) / r.width * count));
  };
  let down = false;
  bars.addEventListener('pointerdown', (e) => { down = true; pick(e); });
  bars.addEventListener('pointermove', (e) => { if (down || e.pointerType === 'mouse') pick(e); });
  const up = () => { down = false; };
  bars.addEventListener('pointerup', up);
  bars.addEventListener('pointercancel', up);
  bars.addEventListener('pointerleave', up);
  select(count - 1);

  const sum = 'За ' + count + ' дней: ' + opts.words(total) + ', в среднем ' + num(Math.round(total / active)) + ' в день';
  box.append(head, bars, info, make('p', 'dchart-hint', 'Коснитесь столбика, чтобы увидеть день'), make('p', 'dchart-sum', sum));
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

  const chart = dayChart(days, { dateKey, words, duration });

  el.menuList.replaceChildren(stats, chart, list, tools);
  el.menuList.scrollTop = 0;
}

// ---------- сохранение прогресса в файл ----------

function progressData() {
  return { app: 'bible-speedread', version: 1, exported: new Date().toISOString(), pos: freeze(pos), wpm, rhythm: RHYTHM, history: readHistory, days, read: readMap };
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
  if (data.wpm >= WPM_MIN && data.wpm <= WPM_MAX) wpm = (data.rhythm || 1) < RHYTHM ? fromRhythm1(data.wpm) : data.wpm;
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

// null - строка о выбранном управлении (MODES)
const HELP = [
  ['Как читать', [
    null,
    'Смотрите на красную букву: она всегда в одной точке, глаза не двигаются.',
    'На паузе внизу виден весь стих, текущее слово подчёркнуто.',
    'Способ управления и шрифт - Меню → ⚙ Настройки.',
  ]],
  ['Переходы', [
    'Короткое касание у левого края - стих назад, у правого - вперёд.',
    'Кнопки «‹ стих» и «стих ›» внизу делают то же самое.',
    'Свайп вверх или вниз - переключает показ: по словам / стихом. То же: касание стиха внизу на паузе и касание слова внизу при показе стихом.',
    'Касание названия книги вверху - выбор книги и главы.',
    '⚑ на паузе - отметить стих: слишком быстро, ошибка в тексте или другое.',
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

// «Как читать» при показе стихом: красной буквы и подчёркнутого слова нет
function helpVerse() {
  return [
    viewManual() ? VIEWS[2][2] : mode[2].replace('слова идут', 'стихи идут'),
    'Длинный стих делится на части по запятым и точкам с запятой.',
    'Способ показа, управление и шрифт - Меню → ⚙ Настройки.',
  ];
}

function showHelp() {
  el.menuTitle.textContent = 'Справка';
  subScreen('Назад');
  const box = node('div', 'help');
  for (const [title, lines] of HELP) {
    const ul = node('ul');
    for (const line of title === 'Как читать' && viewVerse() ? helpVerse() : lines) ul.append(node('li', '', line ?? mode[2]));
    box.append(node('h3', '', title), ul);
  }
  const tools = node('div', 'tools');
  const write = node('button', '', 'Написать отзыв');
  write.type = 'button';
  write.addEventListener('click', showFeedback);
  tools.append(write);
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

// ---------- настройки: управление и шрифт ----------

function showSettings() {
  el.menuTitle.textContent = 'Настройки';
  subScreen('Назад');
  const box = node('div', 'help');
  const views = node('div', 'choices');
  for (const x of VIEWS) {
    const btn = node('button', x === view ? 'on' : '', x[1]);
    btn.type = 'button';
    btn.append(node('small', '', x[2]));
    btn.addEventListener('click', () => {
      setView(x);
      views.querySelectorAll('button').forEach((y) => y.classList.toggle('on', y === btn));
    });
    views.append(btn);
  }
  const modes = node('div', 'choices');
  for (const m of MODES) {
    const btn = node('button', m === mode ? 'on' : '', m[1]);
    btn.type = 'button';
    btn.append(node('small', '', m[2].replace(/ - /g, ' - '))); // тире не переносится в начало строки
    btn.addEventListener('click', () => {
      mode = m;
      store('mode', m[0]);
      showHint();
      modes.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === btn));
    });
    modes.append(btn);
  }
  const fonts = node('div', 'choices');
  for (const f of FONTS) {
    const btn = node('button', f === font ? 'on' : '');
    btn.type = 'button';
    const word = 'благосклонен';
    const p = pivotIndex(word);
    const sample = node('span', 'font-sample', word.slice(0, p));
    sample.style.fontFamily = f[2];
    sample.append(node('i', '', word[p]), word.slice(p + 1));
    btn.append(sample, node('small', '', f[1]));
    btn.addEventListener('click', () => {
      store('font', f[0]);
      applyFont(f);
      fonts.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === btn));
    });
    fonts.append(btn);
  }
  box.append(node('h3', '', 'Показ'), views, node('h3', '', 'Управление'), modes, node('h3', '', 'Шрифт'), fonts);
  el.menuList.replaceChildren(box);
  el.menuList.scrollTop = 0;
}

function openHelp() {
  pause();
  endManual();
  tab = pos.b < OT ? 'ot' : 'nt';
  showHelp();
  el.menu.hidden = false;
}

el.ref.addEventListener('click', openMenu);
$('menu-help').addEventListener('click', showHelp);
$('menu-settings').addEventListener('click', showSettings);
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
applyFont(font);
showHint();
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

// ---------- отзывы и отметки стихов ----------
// Уходят на сервер (папка feedback/, Cloudflare Worker): строка в базе + сообщение автору в Telegram.
// Без сети ждут в очереди rsvp.outbox и досылаются при запуске, при появлении сети и при возврате в приложение.
// Номер устройства не шлём - на странице «О проекте» обещаны только текст, стих, версия и тип устройства.

const FEEDBACK_URL = 'https://bible-speedread-feedback.imenie.workers.dev/send';
const REASONS = [['fast', 'Слишком быстро'], ['typo', 'Ошибка в тексте'], ['other', 'Другое']];
const SENT_TEXT = {
  ok: 'Спасибо! Отправлено.',
  offline: 'Нет интернета - отправим, когда появится.',
  error: 'Не получилось отправить. Попробуйте позже.',
};
let outbox = load('outbox', []);
let delivering = null;

// text/plain - простой запрос, без предварительного CORS-запроса
function deliver() {
  if (delivering) return delivering;
  delivering = (async () => {
    try {
      while (outbox.length) {
        if (navigator.onLine === false) return 'offline';
        let r;
        try {
          r = await fetch(FEEDBACK_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(outbox[0]) });
        } catch (e) {
          return 'offline';
        }
        if (r.status === 429 || r.status >= 500) return 'error'; // остаётся в очереди, повторим позже
        outbox.shift();
        store('outbox', outbox);
        if (!r.ok) return 'error';
      }
      return 'ok';
    } finally {
      delivering = null;
    }
  })();
  return delivering;
}

async function submit(item) {
  outbox.push({
    ...item,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    wpm, rhythm: RHYTHM, version: VERSION, platform: PLATFORM,
  });
  store('outbox', outbox);
  track(item.kind === 'verse' ? 'verse_flag' : 'feedback', item.reason ? { reason: item.reason } : {});
  if (delivering) await delivering;
  return deliver();
}

function textField(tag, placeholder, max) {
  const f = document.createElement(tag);
  f.placeholder = placeholder;
  f.maxLength = max;
  if (tag === 'textarea') f.rows = 5;
  return f;
}

// скриншот к отзыву: только jpg/png/webp, перерисовывается в JPEG (метаданные и EXIF пропадают), до 1600 px
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_MAX_BYTES = 1500000;

async function prepareImage(file) {
  if (!IMAGE_TYPES.includes(file.type) || file.size > 30000000) return null;
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch (e) {
    return null;
  }
  let scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', attempt < 2 ? 0.8 : 0.6);
    if (url.length * 0.75 <= IMAGE_MAX_BYTES) {
      bmp.close();
      return { url, data: url.slice(url.indexOf(',') + 1) };
    }
    scale *= 0.7;
  }
  bmp.close();
  return null;
}

function showFeedback() {
  el.menuTitle.textContent = 'Отзыв';
  subScreen('Назад');
  const box = node('div', 'form');
  const text = textField('textarea', 'Что понравилось, что мешает, чего не хватает', 2000);
  const contact = textField('input', 'Как с вами связаться (необязательно)', 200);
  const send = node('button', 'primary', 'Отправить');
  send.type = 'button';

  let image = null;
  const file = node('input');
  file.type = 'file';
  file.accept = IMAGE_TYPES.join(',');
  file.hidden = true;
  const attach = node('div', 'attach');
  const pick = node('button', '', 'Прикрепить скриншот');
  pick.type = 'button';
  const hint = node('p', 'attach-hint', 'Увидит только автор. Проверьте, что на скриншоте нет личных данных.');
  const preview = node('div', 'attach-preview');
  preview.hidden = true;
  const thumb = node('img');
  thumb.alt = '';
  const remove = node('button', '', 'Убрать');
  remove.type = 'button';
  preview.append(thumb, remove);
  attach.append(pick, hint, preview, file);
  const showImage = (img) => {
    image = img;
    pick.hidden = hint.hidden = !!img;
    preview.hidden = !img;
    if (img) thumb.src = img.url;
  };
  pick.addEventListener('click', () => file.click());
  remove.addEventListener('click', () => { file.value = ''; showImage(null); });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    pick.disabled = true;
    const img = await prepareImage(f);
    pick.disabled = false;
    file.value = '';
    if (img) showImage(img);
    else hint.textContent = 'Не получилось прикрепить. Подойдут картинки jpg, png или webp.';
  });

  send.addEventListener('click', async () => {
    if (!text.value.trim()) {
      text.focus();
      return;
    }
    send.disabled = true;
    const res = await submit({ kind: 'feedback', text: text.value, contact: contact.value, ...(image ? { image: image.data } : {}) });
    box.replaceChildren(node('p', 'sent', SENT_TEXT[res]));
  });
  box.append(text, contact, attach, send);
  el.menuList.replaceChildren(box);
  el.menuList.scrollTop = 0;
}

function openFlag() {
  const t = cur();
  if (t.h) return;
  pause();
  endManual();
  const at = { b: pos.b, c: pos.c, v: t.v, word: viewVerse() ? '' : t.t };
  el.menuTitle.textContent = 'Отметить стих';
  el.menuBack.hidden = true;
  menuIcons(false);
  el.tabs.hidden = true;

  const box = node('div', 'form');
  const verse = node('p', 'flag-verse');
  verse.innerHTML = el.context.innerHTML;
  const reasons = node('div', 'reasons');
  const comment = textField('textarea', 'Комментарий (необязательно)', 2000);
  comment.rows = 3;
  const send = node('button', 'primary', 'Отправить');
  const cancel = node('button', '', 'Отмена');
  send.type = cancel.type = 'button';
  send.disabled = true;
  let reason = null;
  for (const [code, label] of REASONS) {
    const btn = node('button', '', label);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      reason = code;
      reasons.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === btn));
      send.disabled = false;
    });
    reasons.append(btn);
  }
  cancel.addEventListener('click', closeMenu);
  send.addEventListener('click', async () => {
    send.disabled = true;
    const res = await submit({
      kind: 'verse', reason, text: comment.value,
      ref: BOOKS[at.b].s + ' ' + (at.c + 1) + ':' + (at.v + 1), b: at.b, c: at.c, v: at.v, word: at.word,
    });
    box.replaceChildren(node('p', 'sent', SENT_TEXT[res]));
    if (res === 'ok') setTimeout(() => { if (!el.menu.hidden && box.isConnected) closeMenu(); }, 1500);
  });
  const row = node('div', 'row');
  row.append(cancel, send);
  box.append(node('p', 'flag-ref', BOOKS[at.b].n + ' ' + (at.c + 1) + ':' + (at.v + 1)), verse, reasons, comment, row);
  el.menuList.replaceChildren(box);
  el.menuList.scrollTop = 0;
  el.menu.hidden = false;
}

// ---------- поделиться стихом ----------
// Стих целиком (даже если на экране его часть) и ссылка на место; без ссылки на приложение (решение 04.11.2026).
// Android - плагин Share, иначе системное меню браузера, иначе копирование в буфер.

let toastTimer = 0;

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { /* ок */ }
    ta.remove();
    return ok;
  }
}

async function shareVerse() {
  const t = cur();
  if (t.h) return;
  const text = BOOKS[pos.b].c[pos.c][t.v] + '\n' + BOOKS[pos.b].n + ' ' + (pos.c + 1) + ':' + (t.v + 1);
  try {
    if (plugins.Share) {
      await plugins.Share.share({ text, dialogTitle: 'Поделиться стихом' });
      return;
    }
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
  } catch (e) {
    if (e && (e.name === 'AbortError' || /cancel/i.test(e.message || ''))) return; // человек закрыл меню
  }
  toast(await copyText(text) ? 'Скопировано' : 'Не получилось скопировать');
}

$('share').addEventListener('click', shareVerse);
$('flag').addEventListener('click', openFlag);
window.addEventListener('online', () => { if (outbox.length) deliver(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && outbox.length) deliver(); });
if (outbox.length) deliver();

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
