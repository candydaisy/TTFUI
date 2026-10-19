// ================================
// VOICE TOOL (voice.html)
// ================================
// Cast speakers to fish.audio voices, generate takes for chosen lines, listen,
// and keep the good ones. Everything goes through /api requests: the local
// helper (serve.js) answers them, or on the website voice-folder.js does, with
// a game folder the person opens. Files land in Assets/audio/voice/<Route>/<id>[_th].mp3.
import { escapeHTML, showToast } from './utils.js';
import { voiceLines, fileName, speakersOf, batchSlots } from './voice-data.js';
import { folderApi } from './voice-folder.js';

const ROUTE_KEY = 'ttfui_voice_route';
const FISH_KEY = 'ttfui_fish_key';
const RELAY_KEY = 'ttfui_fish_relay';
const GAME_DIR_KEY = 'ttfui_game_dir';
const LANGS = { en: 'EN', th: 'TH' };

const v = {
  project: null,          // GET /api/project
  route: '',
  lines: [],              // voiceLines() of the route
  files: new Set(),       // saved voice file names in the route
  ticked: new Set(),      // line ids
  takes: new Map(),       // 'route|id|lang' -> { blob, url } waiting for Keep
  busy: new Set(),        // 'route|id|lang' being generated
  batch: null,            // { done, total } while Generate ticked runs
};
const player = new Audio();
// every route has a "start" node, so takes are keyed by route too
const slotKey = (route, id, lang) => `${route}|${id}|${lang}`;
// batchSlots' pending set for the current route: 'id|lang'
const pendingHere = () => new Set([...v.takes.keys()].filter(k => k.startsWith(v.route + '|')).map(k => k.slice(v.route.length + 1)));
const casting = () => v.project.voices;
const lineById = id => v.lines.find(l => l.id === id);
const speakerName = s => s || 'Narrator';
const keyInput = document.getElementById('key-input');
const relayInput = document.getElementById('relay-input');

// who answers /api: the helper, until a game folder is opened in the browser
let inBrowser = false;
// game folder path for the helper; empty = the one it found itself
let gameDir = '';
try { gameDir = localStorage.getItem(GAME_DIR_KEY) || ''; } catch { /* storage blocked */ }
let request = (method, url, body) => fetch(url, {
  method,
  body: body instanceof Blob || body === undefined ? body : JSON.stringify(body),
  headers: {
    ...(body instanceof Blob || body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(gameDir ? { 'X-Game-Dir': encodeURIComponent(gameDir) } : {}),
  },
});

// throws the { error } message on failure
async function api(method, url, body) {
  const res = await request(method, url, body);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try { message = (await res.json()).error || message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  return res;
}

function play(url) {
  player.src = url;
  player.play().catch(err => showToast(`Can't play: ${err.message}`));
}

// ================================
// LOAD
// ================================
async function load() {
  try {
    v.project = await (await api('GET', '/api/project')).json();
  } catch (err) {
    // the helper answered but has no game folder: ask for its path
    showSetup(true, !inBrowser && /^Game folder not found/.test(err.message));
    // a plain static host has no /api, so its 404 page isn't worth showing
    document.getElementById('no-helper-detail').textContent = /^404\b/.test(err.message) ? '' : err.message;
    return;
  }
  showSetup(false);
  renderKeyStatus();

  const select = document.getElementById('route-select');
  select.innerHTML = v.project.routes.map(r => `<option value="${escapeHTML(r.name)}">${escapeHTML(r.name)}</option>`).join('');
  let saved = '';
  try { saved = localStorage.getItem(ROUTE_KEY) || ''; } catch { /* storage blocked */ }
  selectRoute(v.project.routes.some(r => r.name === saved) ? saved : (v.project.routes[0] || {}).name || '');
  document.getElementById('model-select').value = casting().model || 's2.1-pro';
}

function showSetup(on, askGameDir = false) {
  document.getElementById('game-dir-row').hidden = !askGameDir;
  document.getElementById('setup-web').hidden = askGameDir;
  document.getElementById('helper-settings').hidden = inBrowser;
  if (v.project) document.getElementById('game-dir-label').textContent = v.project.gameDir;
  document.getElementById('main').hidden = on;
  document.getElementById('no-helper').hidden = !on;
  document.querySelectorAll('#route-select, #filter-select, #search-input, #gen-ticked-btn').forEach(el => { el.hidden = on; });
  document.getElementById('browser-settings').hidden = !inBrowser;
  const canPick = 'showDirectoryPicker' in window;
  document.getElementById('open-folder-btn').hidden = !canPick;
  document.getElementById('no-picker').hidden = canPick;
}

async function openFolder() {
  let game;
  try { game = await window.showDirectoryPicker({ id: 'ttfui-game', mode: 'readwrite' }); } catch { return; } // cancelled
  inBrowser = true;
  request = folderApi(game, () => ({ key: keyInput.value.trim(), relay: relayInput.value.trim() }));
  load();
}

function useGameDir() {
  // pasted paths often come quoted ("Copy as path" on Windows)
  gameDir = document.getElementById('game-dir-input').value.trim().replace(/^(['"])(.*)\1$/, '$2');
  try { if (gameDir) localStorage.setItem(GAME_DIR_KEY, gameDir); else localStorage.removeItem(GAME_DIR_KEY); } catch { /* storage blocked */ }
  load();
}

function changeGameDir() {
  // new takes belong to this game; another game may have the same route and line
  if (v.takes.size) { showToast('Keep or discard the new takes first'); return; }
  document.getElementById('game-dir-input').value = gameDir || v.project.gameDir;
  document.getElementById('no-helper-detail').textContent = '';
  showSetup(true, true);
}

function renderKeyStatus() {
  const keyEl = document.getElementById('key-status');
  const ok = v.project.hasKey;
  keyEl.textContent = ok ? '● fish.audio key set' : inBrowser ? '○ needs key + relay' : '○ no fish.audio key';
  keyEl.title = ok ? '' : inBrowser ? 'Paste your fish.audio key and relay URL under Casting' : 'Put FISH_API_KEY=... in .TTFUI/.env and restart npm start';
  keyEl.classList.toggle('vl-warn', !ok);
}

function selectRoute(name) {
  const route = v.project.routes.find(r => r.name === name);
  v.route = name;
  document.getElementById('route-select').value = name;
  try { localStorage.setItem(ROUTE_KEY, name); } catch { /* storage blocked */ }
  v.ticked.clear();
  v.lines = route ? voiceLines(route.graph, route.th) : [];
  v.files = new Set(route ? route.files : []);
  renderCasting();
  renderList();
}

// ================================
// RENDER
// ================================
function slotHTML(line, lang) {
  const k = slotKey(v.route, line.id, lang);
  const data = `data-id="${escapeHTML(line.id)}" data-lang="${lang}"`;
  const label = `<span class="vl-lang">${LANGS[lang]}</span>`;
  if (!casting().voices[line.speaker]) {
    return `<div class="vl-slot">${label}<span class="vl-hint">cast ${escapeHTML(speakerName(line.speaker))} first</span></div>`;
  }
  if (v.busy.has(k)) return `<div class="vl-slot">${label}<span class="vl-hint">generating…</span></div>`;
  if (v.takes.has(k)) {
    return `<div class="vl-slot take">${label}
      <button class="vl-btn" data-action="playTake" ${data} title="Listen to the new take">▶</button>
      <button class="vl-btn keep" data-action="keep" ${data} title="Save into the game">Keep</button>
      <button class="vl-btn" data-action="generate" ${data} title="Another take">Redo</button>
      <button class="vl-btn" data-action="discard" ${data} title="Throw this take away">✕</button></div>`;
  }
  if (v.files.has(fileName(line.id, lang))) {
    return `<div class="vl-slot voiced">${label}
      <button class="vl-btn" data-action="playSaved" ${data} title="Play the saved voice">● ▶</button>
      <button class="vl-btn" data-action="generate" ${data} title="Make a new take (the saved one stays until you Keep)">Redo</button></div>`;
  }
  return `<div class="vl-slot">${label}<button class="vl-btn" data-action="generate" ${data} title="Generate a take">Gen</button></div>`;
}

function visibleLines() {
  const filter = document.getElementById('filter-select').value;
  const q = document.getElementById('search-input').value.trim().toLowerCase();
  const voiced = l => v.files.has(fileName(l.id, 'en')) || v.files.has(fileName(l.id, 'th'));
  const byFilter = l => filter === 'all' || (filter === 'ticked' ? v.ticked.has(l.id) : (filter === 'voiced') === voiced(l));
  return v.lines.filter(l => byFilter(l) && (!q || [l.id, l.speaker, l.en, l.th].some(s => s.toLowerCase().includes(q))));
}

function renderList() {
  const list = document.getElementById('voice-list');
  const lines = visibleLines();
  list.innerHTML = lines.length ? lines.map(l => `
    <div class="vl-row${v.ticked.has(l.id) ? ' ticked' : ''}">
      <input type="checkbox" class="vl-tick" data-id="${escapeHTML(l.id)}" ${v.ticked.has(l.id) ? 'checked' : ''} aria-label="Tick line ${escapeHTML(l.id)}">
      <span class="vl-id">${escapeHTML(l.id)}</span>
      <span class="vl-speaker">${escapeHTML(speakerName(l.speaker))}</span>
      <div class="vl-texts">
        <div>${escapeHTML(l.en)}</div>
        ${l.th ? `<div class="vl-th">${escapeHTML(l.th)}</div>` : ''}
      </div>
      <div class="vl-slots">${slotHTML(l, 'en')}${l.th ? slotHTML(l, 'th') : ''}</div>
    </div>`).join('') : `<p class="vl-empty">No lines match.</p>`;
  renderToolbar();
}

function renderToolbar() {
  const genBtn = document.getElementById('gen-ticked-btn');
  if (v.batch) {
    genBtn.textContent = `Generating ${v.batch.done + 1}/${v.batch.total}…`;
    genBtn.disabled = true;
  } else {
    const slots = batchSlots(v.lines, { ticked: v.ticked, voices: casting().voices, files: v.files, pending: pendingHere() });
    const chars = slots.reduce((n, s) => n + s.text.length, 0);
    genBtn.textContent = slots.length ? `Generate ticked (${slots.length} · ~${chars} chars)` : 'Generate ticked';
    genBtn.disabled = !slots.length;
  }
  const keepAll = document.getElementById('keep-all-btn');
  keepAll.hidden = !v.takes.size;
  keepAll.textContent = `Keep all new takes (${v.takes.size})`;
}

function renderCasting() {
  document.getElementById('casting-list').innerHTML = speakersOf(v.lines).map(s => `
    <div class="field-group">
      <div class="field-label">${escapeHTML(speakerName(s))}</div>
      <div class="vl-cast-row">
        <input class="field-input mono" data-speaker="${escapeHTML(s)}" value="${escapeHTML(casting().voices[s] || '')}" placeholder="fish.audio voice ID" autocomplete="off" spellcheck="false">
        <button class="tb-btn" data-action="tryVoice" data-speaker="${escapeHTML(s)}" title="Hear a short sample">Try</button>
      </div>
    </div>`).join('');
}

// ================================
// ACTIONS
// ================================
// slot = { route, id, lang, speaker, text }, fixed when the take is asked for,
// so switching route while it generates can't move it to another line
async function generate(slot, { autoplay = true } = {}) {
  const k = slotKey(slot.route, slot.id, slot.lang);
  v.busy.add(k);
  renderList();
  try {
    const res = await api('POST', '/api/tts', { text: slot.text, voice: casting().voices[slot.speaker], language: slot.lang, model: casting().model });
    const blob = await res.blob();
    if (v.takes.has(k)) URL.revokeObjectURL(v.takes.get(k).url);
    v.takes.set(k, { blob, url: URL.createObjectURL(blob) });
    if (autoplay) play(v.takes.get(k).url);
  } catch (err) {
    showToast(err.message);
    throw err;
  } finally {
    v.busy.delete(k);
    renderList();
  }
}

async function keep(route, id, lang) {
  const k = slotKey(route, id, lang);
  const take = v.takes.get(k);
  if (!take) return;
  const name = fileName(id, lang);
  await api('PUT', `/api/voice/${encodeURIComponent(route)}/${name}`, take.blob);
  const r = v.project.routes.find(x => x.name === route);
  r.files = [...new Set([...r.files, name])];
  if (route === v.route) v.files.add(name);
  URL.revokeObjectURL(take.url);
  v.takes.delete(k);
}

function discard(id, lang) {
  const k = slotKey(v.route, id, lang);
  const take = v.takes.get(k);
  if (take) URL.revokeObjectURL(take.url);
  v.takes.delete(k);
  renderList();
}

async function genTicked() {
  const route = v.route;
  const slots = batchSlots(v.lines, { ticked: v.ticked, voices: casting().voices, files: v.files, pending: pendingHere() });
  v.batch = { done: 0, total: slots.length };
  let failed = 0;
  // one at a time so fish.audio isn't flooded
  for (const s of slots) {
    renderToolbar();
    try { await generate({ ...s, route }, { autoplay: false }); } catch { failed++; }
    v.batch.done++;
  }
  v.batch = null;
  renderToolbar();
  showToast(failed ? `${slots.length - failed} takes ready, ${failed} failed` : `${slots.length} takes ready to review`);
}

async function keepAll() {
  const keys = [...v.takes.keys()];
  try {
    for (const k of keys) {
      const [route, id, lang] = k.split('|');
      await keep(route, id, lang);
    }
    showToast(`Saved ${keys.length} voice files`);
  } catch (err) {
    showToast(err.message);
  }
  renderList();
}

let castingTimer = null;
function saveCastingSoon() {
  clearTimeout(castingTimer);
  castingTimer = setTimeout(() => api('PUT', '/api/voices', casting()).catch(err => showToast(err.message)), 400);
}

async function tryVoice(speaker) {
  const voice = casting().voices[speaker];
  if (!voice) { showToast(`Paste a voice ID for ${speakerName(speaker)} first`); return; }
  try {
    const res = await api('POST', '/api/tts', { text: `Hi, this is ${speaker || 'the narrator'}.`, voice, language: 'en', model: casting().model });
    play(URL.createObjectURL(await res.blob()));
  } catch (err) {
    showToast(err.message);
  }
}

const ACTIONS = {
  generate: el => {
    const line = lineById(el.dataset.id);
    const lang = el.dataset.lang;
    generate({ route: v.route, id: line.id, lang, speaker: line.speaker, text: line[lang] }).catch(() => {});
  },
  playTake: el => play(v.takes.get(slotKey(v.route, el.dataset.id, el.dataset.lang)).url),
  playSaved: el => api('GET', `/api/voice/${encodeURIComponent(v.route)}/${fileName(el.dataset.id, el.dataset.lang)}`)
    .then(res => res.blob()).then(blob => play(URL.createObjectURL(blob)), err => showToast(err.message)),
  keep: el => keep(v.route, el.dataset.id, el.dataset.lang)
    .then(() => showToast(`Saved ${v.route}/${fileName(el.dataset.id, el.dataset.lang)}`), err => showToast(err.message))
    .then(renderList),
  discard: el => discard(el.dataset.id, el.dataset.lang),
  genTicked: () => genTicked(),
  keepAll: () => keepAll(),
  tryVoice: el => tryVoice(el.dataset.speaker),
  openFolder: () => openFolder(),
  useGameDir: () => useGameDir(),
  changeGameDir: () => changeGameDir(),
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && ACTIONS[el.dataset.action]) ACTIONS[el.dataset.action](el);
});

document.getElementById('voice-list').addEventListener('change', e => {
  if (!e.target.classList.contains('vl-tick')) return;
  const id = e.target.dataset.id;
  if (e.target.checked) v.ticked.add(id); else v.ticked.delete(id);
  e.target.closest('.vl-row').classList.toggle('ticked', e.target.checked);
  renderToolbar();
});

document.getElementById('casting-list').addEventListener('input', e => {
  const speaker = e.target.dataset.speaker;
  if (speaker === undefined) return;
  const id = e.target.value.trim();
  if (id) casting().voices[speaker] = id; else delete casting().voices[speaker];
  saveCastingSoon();
  renderList();
});

document.getElementById('model-select').addEventListener('change', e => {
  casting().model = e.target.value;
  saveCastingSoon();
});
document.getElementById('route-select').addEventListener('change', e => selectRoute(e.target.value));
try {
  keyInput.value = localStorage.getItem(FISH_KEY) || '';
  relayInput.value = localStorage.getItem(RELAY_KEY) || '';
} catch { /* storage blocked */ }
for (const [input, storeKey] of [[keyInput, FISH_KEY], [relayInput, RELAY_KEY]]) {
  input.addEventListener('input', () => {
    try { localStorage.setItem(storeKey, input.value.trim()); } catch { /* storage blocked */ }
    v.project.hasKey = Boolean(keyInput.value.trim() && relayInput.value.trim());
    renderKeyStatus();
  });
}
document.getElementById('game-dir-input').addEventListener('keydown', e => { if (e.key === 'Enter') useGameDir(); });
window.addEventListener('beforeunload', e => { if (v.takes.size) e.preventDefault(); });
document.getElementById('filter-select').addEventListener('change', renderList);
document.getElementById('search-input').addEventListener('input', renderList);

load();
