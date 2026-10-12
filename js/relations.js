// ================================
// RELATIONSHIP WEB EDITOR (relations.html)
// ================================
// Edits Story/relationships.json with the same graph the game shows in its
// Gallery. The data logic lives in relations-data.js; this file is the UI.
import { escapeHTML, showToast } from './utils.js';
import {
  emptyWeb, normalizeWeb, parseWeb, formatWeb, findCharacter, characterColor, relationsOf,
  addCharacter, updateCharacter, renameCharacter, removeCharacter, addLink, updateLinkLabels, removeLink,
  checkWeb, storySpeakers, layoutStep, initialPositions
} from './relations-data.js';

const SAVE_KEY = 'ttfui_relations';
const PLAYABLE_R = 16, OTHER_R = 10;
const FONT = getComputedStyle(document.body).fontFamily || 'sans-serif';

const ed = {
  web: emptyWeb(),
  pos: {},          // id -> { x, y, vx, vy, pinned }
  selected: '',
  hovered: '',
  pan: { x: 0, y: 0 },
  zoom: 1,
  heat: 1,          // layout settles as this cools; dragging warms it up
  stories: [],      // [{ route, speakers }] from "Open Story Folder"
  undo: [],
  redo: [],
};

const canvas = document.getElementById('web-canvas');
const ctx = canvas.getContext('2d');
const sidebar = document.getElementById('sidebar-content');

// ================================
// CHANGES, UNDO, AUTOSAVE
// ================================
function commit(nextWeb, { keepRedo = false } = {}) {
  if (!nextWeb || JSON.stringify(nextWeb) === JSON.stringify(ed.web)) return;
  ed.undo.push(JSON.stringify(ed.web));
  if (ed.undo.length > 100) ed.undo.shift();
  if (!keepRedo) ed.redo = [];
  setWeb(nextWeb);
}

function setWeb(web) {
  ed.web = web;
  ed.pos = initialPositions(web, ed.pos);
  if (ed.selected && !findCharacter(web, ed.selected)) ed.selected = '';
  ed.heat = Math.max(ed.heat, 0.3);
  refresh();
  scheduleSave();
}

function undo() {
  if (!ed.undo.length) return;
  ed.redo.push(JSON.stringify(ed.web));
  setWeb(JSON.parse(ed.undo.pop()));
}

function redo() {
  if (!ed.redo.length) return;
  ed.undo.push(JSON.stringify(ed.web));
  setWeb(JSON.parse(ed.redo.pop()));
}

let saveTimer = null;
function scheduleSave() {
  setStatus('unsaved', 'var(--warning)');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const pos = {};
      Object.entries(ed.pos).forEach(([id, p]) => { pos[id] = { x: p.x, y: p.y }; });
      localStorage.setItem(SAVE_KEY, JSON.stringify({ web: ed.web, pos, stories: ed.stories }));
      setStatus('saved', 'var(--success)');
    } catch (e) {
      setStatus('save failed', 'var(--danger)');
    }
  }, 800);
}

function setStatus(text, color) {
  const el = document.getElementById('save-status');
  el.textContent = text;
  el.style.color = color;
}

function loadSaved() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!data) return false;
    ed.web = normalizeWeb(data.web);
    ed.pos = initialPositions(ed.web, data.pos || {});
    ed.stories = Array.isArray(data.stories) ? data.stories : [];
    return true;
  } catch (e) {
    return false;
  }
}

function refresh() {
  document.getElementById('undo-btn').disabled = !ed.undo.length;
  document.getElementById('redo-btn').disabled = !ed.redo.length;
  updateIssuesButton();
  renderSidebar();
}

// ================================
// ISSUES
// ================================
function issues() {
  return checkWeb(ed.web, ed.stories);
}

function updateIssuesButton() {
  const list = issues();
  const errors = list.filter(i => i.type === 'error').length;
  const btn = document.getElementById('web-issues-btn');
  btn.textContent = !list.length ? 'No Issues' : errors ? `${errors} Error${errors > 1 ? 's' : ''}` : `${list.length} Warning${list.length > 1 ? 's' : ''}`;
  btn.style.color = !list.length ? 'var(--success)' : errors ? 'var(--danger)' : 'var(--warning)';
}

// ================================
// SIDEBAR
// ================================
function renderSidebar() {
  const c = findCharacter(ed.web, ed.selected);
  sidebar.innerHTML = c ? characterHTML(c) : webHTML();
}

function webHTML() {
  const list = issues();
  const storyNote = ed.stories.length
    ? `Checked against ${ed.stories.map(s => escapeHTML(s.route)).join(', ')}.`
    : 'Use <strong>Open Story Folder</strong> to also check every story for speakers missing from the web.';
  return `
    <p style="color:var(--text-dim);font-size:12px;margin:4px 0 12px;line-height:1.5;">
      ${ed.web.characters.length} characters · ${ed.web.links.length} links.<br>Select a character to edit them.
    </p>
    <div class="field-section">Web</div>
    <div class="field-group">
      <div class="field-label">Ignore speakers (comma separated)</div>
      <input class="field-input" data-web="ignore_speakers" value="${escapeHTML(ed.web.ignore_speakers.join(', '))}" placeholder="Teacher, Lunch Lady">
      <div class="field-hint">Speakers that don't need a dot (narration is "").</div>
    </div>
    <div class="field-group">
      <div class="field-label">About this file</div>
      <textarea class="field-input" data-web="about" rows="3">${escapeHTML(ed.web.about)}</textarea>
    </div>
    <div class="field-section">Issues</div>
    <p style="color:var(--text-dim);font-size:11px;margin-bottom:8px;line-height:1.5;">${storyNote}</p>
    ${list.length ? list.map(i => `
      <div class="web-issue ${i.type}" ${i.id ? `data-select="${escapeHTML(i.id)}"` : ''}>${escapeHTML(i.text)}</div>`).join('')
      : '<p style="color:var(--success);font-size:12px;">No issues.</p>'}
  `;
}

function characterHTML(c) {
  const rel = relationsOf(ed.web, c.id);
  const others = ed.web.characters.filter(o => o.id !== c.id && !(o.id in rel));
  const name = c.name || c.id;
  const field = (label, key, value, placeholder = '', hint = '') => `
    <div class="field-group">
      <div class="field-label">${label}</div>
      <input class="field-input" data-key="${key}" value="${escapeHTML(value || '')}" placeholder="${escapeHTML(placeholder)}">
      ${hint ? `<div class="field-hint">${hint}</div>` : ''}
    </div>`;

  return `
    <div class="web-swatch" style="background:${characterColor(c)}"></div>
    ${field('Id (used by links)', 'id', c.id)}
    ${field('Name (shown in the web)', 'name', c.name)}
    <div class="field-group">
      <label class="field-check"><input type="checkbox" data-key="playable" ${c.playable ? 'checked' : ''}> Playable (drawn in their color)</label>
    </div>
    ${c.playable ? `
    <div class="field-group">
      <div class="field-label">Color (match their side art)</div>
      <div style="display:flex;gap:6px;">
        <input type="color" data-key="color" value="${escapeHTML(/^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#ffffff')}">
        <input class="field-input" data-key="color" value="${escapeHTML(c.color || '')}" placeholder="#5980ff">
      </div>
    </div>` : ''}
    ${field('Speaker (if different from Name)', 'speaker', c.speaker, 'Mom', 'Their name in the story files.')}
    ${field('Route (only match Speaker in this story)', 'route', c.route, 'Kay', 'For people with the same speaker name in different stories.')}
    ${field('Picture', 'picture', c.picture, 'res://Assets/Photos/Sprites/...', 'Empty shows a big colored initial in the game.')}
    <div class="field-group">
      <div class="field-label">About</div>
      <textarea class="field-input" data-key="about" rows="3">${escapeHTML(c.about || '')}</textarea>
    </div>

    <div class="field-section">Links</div>
    ${Object.keys(rel).length ? Object.keys(rel).map(id => linkHTML(c, findCharacter(ed.web, id) || { id })).join('') : '<p style="color:var(--text-dim);font-size:12px;">No links yet.</p>'}
    <div class="choice-row" style="margin-top:8px;">
      <select class="field-input" id="web-link-target" style="flex:1">
        ${others.map(o => `<option value="${escapeHTML(o.id)}">${escapeHTML(o.name || o.id)}</option>`).join('')}
      </select>
      <button class="tb-btn" data-action="addLink" ${others.length ? '' : 'disabled'}>+ Link</button>
    </div>
    <div class="field-hint">Or Shift+click someone in the web.</div>

    <button class="delete-node-btn" data-action="deleteCharacter">Delete ${escapeHTML(name)}</button>
  `;
}

function linkHTML(self, other) {
  const l = ed.web.links.find(x => (x.from === self.id && x.to === other.id) || (x.from === other.id && x.to === self.id));
  const otherIs = l.from === self.id ? l.to_is : l.from_is;
  const selfIs = l.from === self.id ? l.from_is : l.to_is;
  const selfName = escapeHTML(self.name || self.id);
  const otherName = escapeHTML(other.name || other.id);
  return `
    <div class="choice-item" data-other="${escapeHTML(other.id)}">
      <div class="choice-row">
        <span class="web-dot" style="background:${characterColor(other)}"></span>
        <strong style="flex:1;font-size:12px;cursor:pointer;" data-select="${escapeHTML(other.id)}">${otherName}</strong>
        <button class="choice-remove" data-action="removeLink" title="Remove link">×</button>
      </div>
      <div class="field-label">${otherName} is ${selfName}'s...</div>
      <input class="field-input" data-link="otherIs" value="${escapeHTML(otherIs || '')}" placeholder="best friend">
      <div class="field-label" style="margin-top:4px;">${selfName} is ${otherName}'s...</div>
      <input class="field-input" data-link="selfIs" value="${escapeHTML(selfIs || '')}" placeholder="best friend">
    </div>`;
}

// Text fields commit on change (blur / Enter) so one edit = one undo step.
sidebar.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.web === 'ignore_speakers') {
    const list = el.value.split(',').map(s => s.trim());
    commit({ ...ed.web, ignore_speakers: ['', ...list.filter(Boolean)].filter((s, i, a) => a.indexOf(s) === i) });
  } else if (el.dataset.web === 'about') {
    commit({ ...ed.web, about: el.value });
  } else if (el.dataset.key === 'id') {
    const next = renameCharacter(ed.web, ed.selected, el.value);
    if (!next) { showToast('That id is empty or already used'); el.value = ed.selected; return; }
    ed.pos[el.value.trim()] = ed.pos[ed.selected];
    ed.selected = el.value.trim();
    commit(next);
  } else if (el.dataset.key) {
    const key = el.dataset.key;
    const value = key === 'playable' ? el.checked : el.value.trim();
    const fields = { [key]: value };
    if (key === 'playable' && value && !findCharacter(ed.web, ed.selected).color) fields.color = '#ffffff';
    commit(updateCharacter(ed.web, ed.selected, fields));
  } else if (el.dataset.link) {
    const other = el.closest('[data-other]').dataset.other;
    commit(updateLinkLabels(ed.web, ed.selected, other, { [el.dataset.link]: el.value.trim() }));
  }
});

sidebar.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur();
});

sidebar.addEventListener('click', e => {
  const target = e.target.closest('[data-select]');
  if (target) select(target.dataset.select);
});

// ================================
// ACTIONS
// ================================
function select(id) {
  ed.selected = findCharacter(ed.web, id) ? id : '';
  renderSidebar();
}

const ACTIONS = {
  undo, redo,
  addCharacter: () => {
    const { web, id } = addCharacter(ed.web, { name: 'New Character' });
    ed.selected = id;
    commit(web);
    const nameInput = sidebar.querySelector('[data-key="name"]');
    if (nameInput) { nameInput.focus(); nameInput.select(); }
  },
  deleteCharacter: () => {
    const c = findCharacter(ed.web, ed.selected);
    if (c && confirm(`Delete ${c.name || c.id} and all their links?`)) commit(removeCharacter(ed.web, c.id));
  },
  addLink: () => {
    const target = document.getElementById('web-link-target');
    if (target && target.value) commit(addLink(ed.web, ed.selected, target.value));
  },
  removeLink: el => commit(removeLink(ed.web, ed.selected, el.closest('[data-other]').dataset.other)),
  relayout: () => {
    ed.pos = initialPositions(ed.web);
    ed.heat = 1;
    scheduleSave();
  },
  showIssues: () => select(''),
  openImport: () => document.getElementById('web-file-input').click(),
  openFolder: () => document.getElementById('web-folder-input').click(),
  exportWeb: () => {
    document.getElementById('output-code').value = formatWeb(ed.web);
    document.getElementById('modal-overlay').classList.add('active');
  },
  closeExport: () => document.getElementById('modal-overlay').classList.remove('active'),
  copyWeb: () => navigator.clipboard.writeText(document.getElementById('output-code').value).then(() => showToast('Copied')),
  downloadWeb: () => download(),
  saveWebAs: () => saveAs(),
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && ACTIONS[el.dataset.action]) ACTIONS[el.dataset.action](el);
});

document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target.id === 'modal-overlay') ACTIONS.closeExport();
});

window.addEventListener('keydown', e => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement && document.activeElement.tagName);
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey && !typing) { e.preventDefault(); undo(); }
  else if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) && !typing) { e.preventDefault(); redo(); }
  else if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); ACTIONS.exportWeb(); }
  else if (e.key === 'Escape') { ACTIONS.closeExport(); if (!typing) select(''); }
  else if ((e.key === 'Delete') && !typing && ed.selected) ACTIONS.deleteCharacter();
});

// ================================
// FILES
// ================================
function download() {
  const blob = new Blob([document.getElementById('output-code').value], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'relationships.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Downloaded relationships.json');
}

async function saveAs() {
  if (!window.showSaveFilePicker) { download(); return; }
  try {
    const handle = await window.showSaveFilePicker({ suggestedName: 'relationships.json', types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
    const w = await handle.createWritable();
    await w.write(document.getElementById('output-code').value);
    await w.close();
    showToast('Saved ' + handle.name);
  } catch (err) {
    if (err && err.name !== 'AbortError') download();
  }
}

function loadWebText(text, source) {
  try {
    const web = parseWeb(text);
    ed.pos = {};
    ed.selected = '';
    commit(web);
    ed.pos = initialPositions(web);
    ed.heat = 1;
    showToast(`Loaded ${source}: ${web.characters.length} characters`);
  } catch (e) {
    alert('Could not read ' + source + ': ' + e.message);
  }
}

document.getElementById('web-file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (file) loadWebText(await file.text(), file.name);
  e.target.value = '';
});

// Picking the Story folder loads relationships.json and the speakers of every
// <Route>/flow_graph.json, so missing characters show up as issues.
document.getElementById('web-folder-input').addEventListener('change', async e => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  const stories = [];
  let webFile = null;
  for (const file of files) {
    const parts = (file.webkitRelativePath || file.name).split('/');
    if (file.name === 'relationships.json' && !webFile) webFile = file;
    if (file.name === 'flow_graph.json' && parts.length >= 2) {
      try {
        stories.push({ route: parts[parts.length - 2], speakers: storySpeakers(JSON.parse(await file.text())) });
      } catch (err) {
        showToast(`Skipped ${parts.slice(-2).join('/')}: not valid JSON`);
      }
    }
  }
  ed.stories = stories;
  if (webFile) loadWebText(await webFile.text(), 'relationships.json');
  else { refresh(); scheduleSave(); }
  showToast(`Checked ${stories.length} stor${stories.length === 1 ? 'y' : 'ies'}${webFile ? '' : ' (no relationships.json found)'}`);
});

// ================================
// CANVAS
// ================================
function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const center = () => ({ x: canvas.clientWidth / 2 + ed.pan.x, y: canvas.clientHeight / 2 + ed.pan.y });
const toScreen = p => { const c = center(); return { x: c.x + p.x * ed.zoom, y: c.y + p.y * ed.zoom }; };
const toWeb = (x, y) => { const c = center(); return { x: (x - c.x) / ed.zoom, y: (y - c.y) / ed.zoom }; };
const radius = c => (c.playable ? PLAYABLE_R : OTHER_R) * Math.sqrt(ed.zoom);

function nodeAt(x, y) {
  for (const c of ed.web.characters) {
    const p = ed.pos[c.id];
    if (!p) continue;
    const s = toScreen(p);
    if (Math.hypot(s.x - x, s.y - y) <= radius(c) + 6) return c.id;
  }
  return '';
}

function draw() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  const sel = findCharacter(ed.web, ed.selected);
  const rel = sel ? relationsOf(ed.web, sel.id) : {};
  const lit = sel && sel.playable ? characterColor(sel) : '#ffffff';

  ed.web.links.forEach(l => {
    const a = ed.pos[l.from], b = ed.pos[l.to];
    if (!a || !b) return;
    const on = sel && (l.from === sel.id || l.to === sel.id);
    const sa = toScreen(a), sb = toScreen(b);
    ctx.strokeStyle = on ? lit : `rgba(255,255,255,${sel ? 0.06 : 0.18})`;
    ctx.lineWidth = on ? 3 : 1.5;
    ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
  });

  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ed.web.characters.forEach(c => {
    const p = ed.pos[c.id];
    if (!p) return;
    const s = toScreen(p), r = radius(c);
    const dim = sel && c.id !== sel.id && !(c.id in rel);
    ctx.globalAlpha = dim ? 0.3 : 1;
    if (c.id === ed.hovered || c.id === ed.selected) {
      ctx.fillStyle = characterColor(c) + '55';
      ctx.beginPath(); ctx.arc(s.x, s.y, r + 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = characterColor(c);
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();

    const label = (text, y, color, size) => {
      ctx.font = `${size}px ${FONT}`;
      ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.strokeText(text, s.x, y);
      ctx.fillStyle = color; ctx.fillText(text, s.x, y);
    };
    label(c.name || c.id, s.y + r + 16, '#ffffff', 13);
    if (c.id in rel && rel[c.id]) label(rel[c.id], s.y + r + 31, lit, 12);
    ctx.globalAlpha = 1;
  });

  document.getElementById('web-hint').style.display = ed.web.characters.length ? 'none' : 'block';
}

function frame() {
  if (ed.heat > 0.01 || drag.id) {
    layoutStep(ed.web, ed.pos);
    ed.heat *= 0.985;
    if (ed.heat <= 0.01 && !drag.id) scheduleSave(); // remember where it settled
  }
  draw();
  requestAnimationFrame(frame);
}

// ---- mouse ----
const drag = { id: '', panning: false, moved: false, x: 0, y: 0 };

canvas.addEventListener('mousedown', e => {
  const id = nodeAt(e.offsetX, e.offsetY);
  if (id && e.shiftKey && ed.selected && id !== ed.selected) {
    commit(addLink(ed.web, ed.selected, id));
    showToast('Linked. Fill in the labels on the right.');
    return;
  }
  drag.id = id;
  drag.panning = !id;
  drag.moved = false;
  drag.x = e.clientX; drag.y = e.clientY;
  if (id) ed.pos[id].pinned = true;
});

window.addEventListener('mousemove', e => {
  if (!drag.id && !drag.panning) {
    if (e.target === canvas) {
      ed.hovered = nodeAt(e.offsetX, e.offsetY);
      canvas.style.cursor = ed.hovered ? 'pointer' : 'grab';
    }
    return;
  }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.id) {
    const rect = canvas.getBoundingClientRect();
    const p = toWeb(e.clientX - rect.left, e.clientY - rect.top);
    Object.assign(ed.pos[drag.id], p, { vx: 0, vy: 0 });
    ed.heat = 1;
  } else {
    ed.pan.x += dx; ed.pan.y += dy;
  }
});

window.addEventListener('mouseup', () => {
  if (!drag.id && !drag.panning) return;
  if (drag.id) ed.pos[drag.id].pinned = false;
  if (!drag.moved) select(drag.id);
  if (drag.moved && drag.id) scheduleSave();
  drag.id = ''; drag.panning = false;
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const before = toWeb(e.offsetX, e.offsetY);
  ed.zoom = Math.min(2.5, Math.max(0.3, ed.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  const after = toScreen(before);
  ed.pan.x += e.offsetX - after.x;
  ed.pan.y += e.offsetY - after.y;
}, { passive: false });

// ================================
// INIT
// ================================
window.addEventListener('resize', resize);
resize();
loadSaved();
refresh();
requestAnimationFrame(frame);
