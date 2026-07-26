// Browser front end for the drill. All the logic lives in session.js / deck.js / fsrs.js,
// which are the same modules the test suite exercises under node.

import { buildDeck } from './deck.js';
import { Session } from './session.js';
import { PATTERNS, PATTERN_KEYS, contour } from './accent.js';

const SESSION_LENGTH = 50;
const STORE_KEY = 'pitch-pair.cards.v1';

const $ = (id) => document.getElementById(id);
const stage = $('stage');

let deck, session;

init().catch((err) => {
  stage.textContent = `Failed to start: ${err.message}`;
  console.error(err);
});

async function init() {
  const raw = await fetch('./src/data/pairs.json').then((r) => {
    if (!r.ok) throw new Error(`could not load pairs.json (${r.status}). Serve this over http, not file://`);
    return r.json();
  });
  deck = buildDeck(raw);
  startSession();
}

function loadCards() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (!saved) return null;
    // Drop cards for items no longer in the deck, add fresh ones for new items.
    const ids = new Set(deck.map((it) => it.id));
    for (const k of Object.keys(saved)) if (!ids.has(k)) delete saved[k];
    return Object.keys(saved).length ? saved : null;
  } catch {
    return null;
  }
}

function saveCards() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(session.cards));
  } catch { /* private browsing, storage full: the drill still works, progress is not kept */ }
}

function startSession() {
  const carried = loadCards();
  const cards = carried
    ? Object.fromEntries(deck.map((it) => [it.id, carried[it.id] ?? newBlank(it.id)]))
    : null;
  session = new Session({
    deck,
    cards,
    length: SESSION_LENGTH,
    seed: (Math.random() * 2 ** 31) | 0,
    secondsPerItem: 20,
  });
  showNext();
}

function newBlank(id) {
  return { id, state: 1, step: 0, stability: null, difficulty: null, due: Date.now(), lastReview: null };
}

function showNext() {
  const item = session.next();
  updateProgress();
  if (!item) return renderReport();
  renderQuestion(item);
}

function updateProgress() {
  const n = session.answers.length;
  $('progress').textContent = session.finished
    ? `${SESSION_LENGTH} of ${SESSION_LENGTH} done`
    : `item ${n + 1} of ${SESSION_LENGTH}`;
  $('barfill').style.width = `${(n / SESSION_LENGTH) * 100}%`;
}

function renderQuestion(item) {
  stage.replaceChildren();
  stage.append(
    el('div', { class: 'word' }, item.word),
    el('div', { class: 'gloss' }, item.gloss),
    el('div', { class: 'reading' },
      `${item.reading} + が   ·   ${item.moraCount} morae` +
      (item.exemplar ? '   ·   pattern exemplar, not a minimal pair' : '')),
  );
  const choices = el('div', { class: 'choices' });
  PATTERN_KEYS.forEach((key, i) => {
    const p = PATTERNS[key];
    const b = el('button', { class: 'choice', 'data-key': key },
      el('span', { class: 'ja' }, p.ja),
      el('span', { class: 'en' }, `${key} · ${p.en}`),
      el('span', { class: 'hint' }, `${p.hint}   [${i + 1}]`));
    b.addEventListener('click', () => answer(key));
    choices.append(b);
  });
  stage.append(choices);
}

function answer(chosen) {
  const item = session.current;
  const res = session.answer(chosen);
  saveCards();

  for (const b of stage.querySelectorAll('button.choice')) {
    b.disabled = true;
    if (b.dataset.key === res.expected) b.classList.add('is-right');
    else if (b.dataset.key === chosen) b.classList.add('is-wrong');
  }

  const v = el('div', { class: 'verdict' });
  v.append(el('h2', {},
    res.correct
      ? `Correct. ${item.word} is ${res.expected} (${PATTERNS[res.expected].ja}).`
      : `Not quite. ${item.word} is ${res.expected} (${PATTERNS[res.expected].ja}), not ${chosen}.`));

  const row = el('div', { class: 'contours' });
  row.append(contourCard(item.word, item.gloss, item.reading, item.accent, true));
  for (const c of item.contrasts) {
    row.append(contourCard(c.word, c.gloss, item.reading, c.accent, false));
  }
  v.append(row);
  if (item.note) v.append(el('p', { class: 'sub', style: 'margin:.7rem 0 0' }, item.note));

  const actions = el('div', { class: 'row-actions' });
  const next = el('button', {}, session.answers.length >= SESSION_LENGTH ? 'See results' : 'Next  [space]');
  next.addEventListener('click', showNext);
  actions.append(next);
  v.append(actions);
  stage.append(v);
  next.focus();
}

/** OJAD-style pitch line: a dot per mora at high or low, plus the particle. */
function contourCard(word, gloss, reading, accent, isCurrent) {
  const c = contour(reading, accent);
  const cells = [...c.morae, { kana: c.particle, high: c.particleHigh, particle: true }];
  const W = 34, H = 46, PAD = 12;
  const x = (i) => PAD + i * W;
  const y = (high) => (high ? 12 : 30);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', PAD * 2 + (cells.length - 1) * W);
  svg.setAttribute('height', H + 22);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label',
    `${word}: ${cells.map((m) => `${m.kana} ${m.high ? 'high' : 'low'}`).join(', ')}`);

  const ns = (tag, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, val] of Object.entries(attrs)) n.setAttribute(k, val);
    return n;
  };
  for (let i = 0; i < cells.length - 1; i++) {
    svg.append(ns('line', {
      x1: x(i), y1: y(cells[i].high), x2: x(i + 1), y2: y(cells[i + 1].high),
      stroke: 'currentColor', 'stroke-width': 2, opacity: cells[i + 1].particle ? 0.45 : 0.85,
    }));
  }
  cells.forEach((m, i) => {
    svg.append(ns('circle', {
      cx: x(i), cy: y(m.high), r: m.particle ? 4 : 5.5,
      fill: m.particle ? 'var(--bg)' : 'currentColor',
      stroke: 'currentColor', 'stroke-width': 2,
    }));
    const t = ns('text', {
      x: x(i), y: H + 14, 'text-anchor': 'middle', 'font-size': 13,
      fill: m.particle ? 'var(--dim)' : 'currentColor',
    });
    t.textContent = m.kana;
    svg.append(t);
  });

  return el('div', { class: 'contour', style: isCurrent ? '' : 'opacity:.72' },
    el('div', { class: 'cap' }, `${word} · ${gloss} · ${c.pattern} [${accent}]`),
    svg);
}

function renderReport() {
  const rep = session.report();
  stage.replaceChildren();
  stage.append(el('h2', { style: 'margin:0 0 .2rem;font-size:1.05rem' },
    `${rep.correct} of ${rep.total} correct, ${(rep.accuracy * 100).toFixed(1)}%`));
  stage.append(el('p', { class: 'sub', style: 'margin:0 0 1rem' },
    'Per-pattern accuracy is what matters here. A low score on one row means you are hearing the word and not the pattern.'));

  const t = el('table');
  t.append(row('th', ['pattern', 'asked', 'correct', 'accuracy']));
  for (const k of PATTERN_KEYS) {
    const p = rep.perPattern[k];
    t.append(row('td', [
      `${PATTERNS[k].ja} ${k}`, p.asked, p.correct,
      p.accuracy === null ? 'not asked' : `${(p.accuracy * 100).toFixed(1)}%`,
    ]));
  }
  stage.append(t);

  stage.append(el('h2', { style: 'margin:1.4rem 0 .4rem;font-size:.95rem' }, 'What you picked instead'));
  const cm = el('table');
  cm.append(row('th', ['correct ↓ / picked →', ...PATTERN_KEYS]));
  for (const k of PATTERN_KEYS) {
    cm.append(row('td', [k, ...PATTERN_KEYS.map((j) => rep.confusion[k][j] || '·')]));
  }
  stage.append(cm);

  if (rep.scheduledMisses.length) {
    stage.append(el('h2', { style: 'margin:1.4rem 0 .4rem;font-size:.95rem' },
      `FSRS queued ${rep.scheduledMisses.length} item${rep.scheduledMisses.length === 1 ? '' : 's'} for another look`));
    const m = el('table');
    m.append(row('th', ['word', 'stability (days)', 'difficulty', 'next due']));
    for (const x of rep.scheduledMisses) {
      m.append(row('td', [
        x.word, x.stability.toFixed(2), x.difficulty.toFixed(1), humanDue(x.dueInMinutes),
      ]));
    }
    stage.append(m);
  }

  const actions = el('div', { class: 'row-actions' });
  const again = el('button', {}, 'New session');
  again.addEventListener('click', startSession);
  const reset = el('button', { class: 'ghost' }, 'Forget my progress');
  reset.addEventListener('click', () => {
    localStorage.removeItem(STORE_KEY);
    startSession();
  });
  actions.append(again, reset);
  stage.append(actions);
}

function humanDue(minutes) {
  if (minutes < 60) return `${minutes.toFixed(0)} min`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} h`;
  return `${(minutes / 1440).toFixed(1)} d`;
}

function row(cell, values) {
  return el('tr', {}, ...values.map((v) => el(cell, {}, String(v))));
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== '') n.setAttribute(k, v);
  n.append(...kids.filter((k) => k !== null && k !== undefined));
  return n;
}

// Number keys answer, space moves on. Faster than reaching for the mouse 50 times.
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (session?.current) {
    const i = ['1', '2', '3', '4'].indexOf(e.key);
    if (i !== -1) { e.preventDefault(); answer(PATTERN_KEYS[i]); }
  } else if (e.key === ' ' || e.key === 'Enter') {
    const btn = stage.querySelector('.row-actions button');
    if (btn) { e.preventDefault(); btn.click(); }
  }
});
