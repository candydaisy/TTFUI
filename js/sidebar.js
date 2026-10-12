// ================================
// SIDEBAR (node properties editor)
// ================================
import { state } from './state.js';
import { escapeHTML } from './utils.js';
import { emotionsFor, getMode, meterNames, meterKey, conditionsFor, createChoice } from './graph.js';
import { pushHistory } from './history.js';
import { updateNodeEl, renderConnections } from './canvas.js';
import { markDirty } from './io.js';

const option = (value, current, label = value) =>
  `<option value="${escapeHTML(value)}" ${current === value ? 'selected' : ''}>${escapeHTML(label)}</option>`;

// Options for a select, keeping a current value that isn't in the list (e.g. a
// condition from another mode) so it's visible instead of silently changed.
const optionsKeeping = (values, current) =>
  [...values, ...(current && !values.includes(current) ? [current] : [])].map(v => option(v, current)).join('');

// Fields only some modes read (see MODES in graph.js).
function modeFieldsHTML(n) {
  const mode = getMode(state.mode);
  let html = '';
  if (mode.nodeKeys.includes('real_text')) {
    html += `
    <div class="field-group">
      <div class="field-label">Real Text (self-edit)</div>
      <textarea class="field-input" id="f-real" rows="2" placeholder="What they really want to say. While the mask is high, this is typed, deleted, and replaced by Dialog Text.">${escapeHTML(n.realText || '')}</textarea>
    </div>`;
  }
  if (mode.nodeKeys.includes('timed')) {
    html += `
    <div class="field-group">
      <label class="field-check"><input type="checkbox" id="f-timed" ${n.timed ? 'checked' : ''}> Timed choice (running out picks the "perform" choice)</label>
    </div>`;
  }
  return html ? `<div class="field-section">${escapeHTML(mode.label)}</div>${html}` : '';
}

// Emotion choices follow the speaker's character preset. A value that isn't
// in the list (e.g. from an imported file) is still shown so it isn't lost.
function emotionOptionsHTML(n) {
  const emotions = emotionsFor(state.characters, n.speaker);
  const extra = n.emotion && !emotions.includes(n.emotion) ? [n.emotion] : [];
  return `<option value="" ${!n.emotion ? 'selected' : ''}>- none -</option>` +
    [...emotions, ...extra].map(v => option(v, n.emotion)).join('');
}

export function renderSidebar() {
  const content = document.getElementById('sidebar-content');
  if (!content) return;
  const count = state.selectedNodes.size;

  if (count > 1) {
    content.innerHTML = `
      <div style="padding: 4px 0 12px 0;">
        <div style="font-size:14px;font-weight:700;color:var(--accent);margin-bottom:6px;">
          ${count} Nodes Selected
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:14px;line-height:1.6;">
          Selected IDs: ${Array.from(state.selectedNodes).map(id => `<code style="background:var(--surface2);color:var(--text);padding:2px 6px;border-radius:4px;font-family:var(--font-mono);font-size:10px;margin-right:4px;display:inline-block;margin-bottom:4px;">${escapeHTML(id)}</code>`).join('')}
        </div>
        <div style="display:flex;gap:6px;margin-bottom:10px;">
          <button class="tb-btn" style="flex:1;font-size:11px;padding:7px;" data-action="duplicateSelectedNodes">Duplicate (${count})</button>
          <button class="tb-btn" style="flex:1;font-size:11px;padding:7px;" data-action="copySelectedNodes">Copy (${count})</button>
        </div>
        <button class="delete-node-btn" data-action="deleteSelectedNodes">Delete Selected (${count})</button>
      </div>
    `;
    return;
  }

  if (!state.selectedNode || !state.nodes[state.selectedNode]) {
    content.innerHTML = `<p style="color:var(--text-dim);font-size:12px;margin-top:8px">Select a node to edit it.</p>`;
    return;
  }
  const n = state.nodes[state.selectedNode];

  content.innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:12px;">
      <button class="tb-btn" style="flex:1;font-size:11px;padding:6px;" data-action="duplicateNode">Duplicate</button>
      <button class="tb-btn" style="flex:1;font-size:11px;padding:6px;" data-action="copyNode">Copy</button>
    </div>
    <div class="field-group">
      <div class="field-label">Node ID</div>
      <input class="field-input" id="f-id" value="${escapeHTML(n.id)}" placeholder="e.g. 1, secret_1">
    </div>
    <div class="field-group">
      <div class="field-label">Speaker</div>
      <input class="field-input" id="f-speaker" list="character-list" value="${escapeHTML(n.speaker)}" placeholder="K, Friend, (empty for narrator)" autocomplete="off">
      <datalist id="character-list">${state.characters.map(c => `<option value="${escapeHTML(c.name)}">`).join('')}</datalist>
    </div>
    <div class="field-group">
      <div class="field-label">Emotion</div>
      <select class="field-input" id="f-emotion">${emotionOptionsHTML(n)}</select>
    </div>
    <div class="field-group">
      <div class="field-label">Dialog Text</div>
      <textarea class="field-input" id="f-text" rows="3" placeholder="What the character says...">${escapeHTML(n.text)}</textarea>
    </div>

    <div class="field-section">Visuals</div>
    <div class="field-group">
      <div class="field-label">Background (node name)</div>
      <input class="field-input" id="f-bg" value="${escapeHTML(n.background)}" placeholder="bedroom, school...">
    </div>
    <div class="field-group">
      <div class="field-label">Show Characters (comma separated)</div>
      <input class="field-input" id="f-show" value="${escapeHTML(n.showChars)}" placeholder="K, Friend">
    </div>
    <div class="field-group">
      <div class="field-label">Hide Characters (comma separated)</div>
      <input class="field-input" id="f-hide" value="${escapeHTML(n.hideChars)}" placeholder="K, Friend">
    </div>
    <div class="field-group">
      <div class="field-label">Expressions (CharName:anim, ...)</div>
      <input class="field-input" id="f-expr" value="${escapeHTML(n.expression)}" placeholder="K:angry, Friend:smile">
    </div>

    <div class="field-section">Audio</div>
    <div class="field-group">
      <div class="field-label">SFX (one-shot)</div>
      <input class="field-input" id="f-sfx" value="${escapeHTML(n.sfx)}" placeholder="alarm, door...">
    </div>
    <div class="field-group">
      <div class="field-label">Ambience (looping)</div>
      <input class="field-input" id="f-amb" value="${escapeHTML(n.amb)}" placeholder="bedroom, school...">
    </div>
    <div class="field-group">
      <div class="field-label">Voice (stops at the next line)</div>
      <input class="field-input" id="f-voice" value="${escapeHTML(n.voice || '')}" placeholder="kay_wake_3">
    </div>

    ${modeFieldsHTML(n)}

    <div class="field-section">Secret Route</div>
    <div class="field-group">
      <div class="field-label">Condition</div>
      <select class="field-input" id="f-secret-cond">
        <option value="" ${!n.secret.condition?'selected':''}>- none -</option>
        ${optionsKeeping(conditionsFor(state.mode), n.secret.condition)}
      </select>
    </div>
    <div class="field-group">
      <div class="field-label">Value (for ${meterNames(state.mode).join(' / ')} conditions)</div>
      <input class="field-input" id="f-secret-val" value="${escapeHTML(n.secret.value)}" placeholder="e.g. 20">
    </div>
    <div class="field-group">
      <div class="field-label">Flag (for flag conditions)</div>
      <input class="field-input" id="f-secret-flag" value="${escapeHTML(n.secret.flag)}" placeholder="was_honest">
    </div>
    <div class="field-group">
      <div class="field-label">Secret Next Node</div>
      <input class="field-input" id="f-secret-next" value="${escapeHTML(n.secret.next)}" placeholder="secret_1">
    </div>

    <div class="field-section">Choices</div>
    <div class="choices-editor" id="choices-editor">
      ${n.choices.map((c,i) => buildChoiceHTML(i, c)).join('')}
    </div>
    <button class="add-choice-btn" data-action="addChoice">+ Add Choice</button>

    <button class="delete-node-btn" data-action="deleteSelectedNodes">Delete Node</button>
  `;
}

function buildChoiceHTML(i, c) {
  const mode = getMode(state.mode);
  const meterInputs = meterNames(state.mode).map(m => `
        <input class="field-input" style="width:64px" type="number" title="${escapeHTML(mode.meters[m].label)} change" placeholder="${escapeHTML(m)}" value="${escapeHTML(c[meterKey(m)] || 0)}" data-choice-key="${meterKey(m)}">`).join('');
  return `
    <div class="choice-item" id="choice-item-${i}" data-index="${i}">
      <div class="choice-row">
        <input class="field-input" style="flex:1" placeholder="Button text" value="${escapeHTML(c.text)}" data-choice-key="text">
        <button class="choice-remove" data-action="removeChoice">×</button>
      </div>
      <div class="choice-row">
        <select class="field-input" style="flex:1" data-choice-key="type">
          ${optionsKeeping(mode.choiceTypes, c.type)}
        </select>
      </div>
      <div class="choice-row choice-meters">
        ${meterNames(state.mode).map(m => `<span class="choice-meter-label">${escapeHTML(mode.meters[m].label)}</span>`).join('')}
      </div>
      <div class="choice-row">${meterInputs}
        <input class="field-input" style="flex:1;margin-left:4px" placeholder="next node" value="${escapeHTML(c.next)}" data-choice-key="next">
      </div>
      <div class="choice-row">
        <input class="field-input" style="flex:1" placeholder="set_flag (optional)" value="${escapeHTML(c.set_flag)}" data-choice-key="set_flag">
      </div>
    </div>
  `;
}

// Node fields: element id -> setter
const FIELDS = {
  'f-speaker':     (n, v) => { n.speaker = v; },
  'f-emotion':     (n, v) => { n.emotion = v; },
  'f-text':        (n, v) => { n.text = v; },
  'f-bg':          (n, v) => { n.background = v; },
  'f-show':        (n, v) => { n.showChars = v; },
  'f-hide':        (n, v) => { n.hideChars = v; },
  'f-expr':        (n, v) => { n.expression = v; },
  'f-sfx':         (n, v) => { n.sfx = v; },
  'f-amb':         (n, v) => { n.amb = v; },
  'f-voice':       (n, v) => { n.voice = v; },
  'f-real':        (n, v) => { n.realText = v; },
  'f-secret-cond': (n, v) => { n.secret.condition = v; },
  'f-secret-val':  (n, v) => { n.secret.value = v; },
  'f-secret-flag': (n, v) => { n.secret.flag = v; },
  'f-secret-next': (n, v) => { n.secret.next = v; },
};

// All sidebar inputs are handled by delegated listeners, since the sidebar
// DOM is rebuilt whenever the selection changes.
export function setupSidebarEvents() {
  const content = document.getElementById('sidebar-content');

  const onEdit = e => {
    const el = e.target;
    const n = state.nodes[state.selectedNode];
    if (!n) return;

    // choice fields: inputs update on 'input', selects on 'change'
    const key = el.dataset.choiceKey;
    if (key) {
      if ((el.tagName === 'SELECT') !== (e.type === 'change')) return;
      const i = Number(el.closest('.choice-item').dataset.index);
      updateChoice(i, key, key.endsWith('_change') ? (parseFloat(el.value) || 0) : el.value);
      return;
    }

    if (el.id === 'f-timed' && e.type === 'change') {
      pushHistory();
      n.timed = el.checked;
      updateNodeEl(state.selectedNode);
      markDirty();
      return;
    }

    if (e.type === 'input' && FIELDS[el.id]) {
      FIELDS[el.id](n, el.value);
      if (el.id === 'f-speaker') document.getElementById('f-emotion').innerHTML = emotionOptionsHTML(n);
      updateNodeEl(state.selectedNode);
      renderConnections();
      markDirty();
    }
  };
  content.addEventListener('input', onEdit);
  content.addEventListener('change', onEdit);

  // ID field only renames on blur / Enter, not on every keystroke, since renaming
  // rebuilds the sidebar DOM and would otherwise kick focus out after one letter.
  content.addEventListener('focusout', e => {
    if (e.target.id === 'f-id') commitIdField(e.target);
  });
  content.addEventListener('keydown', e => {
    const idEl = e.target;
    if (idEl.id !== 'f-id') return;
    if (e.key === 'Enter') { e.preventDefault(); idEl.blur(); }
    else if (e.key === 'Escape') { idEl.value = state.nodes[state.selectedNode] ? state.nodes[state.selectedNode].id : ''; idEl.blur(); }
  });
}

function commitIdField(idEl) {
  const n = state.nodes[state.selectedNode];
  if (!n) return;
  const newId = idEl.value.trim();
  if (!newId || newId === n.id) { idEl.value = n.id; return; }
  if (state.nodes[newId]) { alert('ID "' + newId + '" already exists.'); idEl.value = n.id; return; }
  renameNode(n.id, newId);
}

function renameNode(oldId, newId) {
  pushHistory();
  const nodes = state.nodes;
  nodes[newId] = { ...nodes[oldId], id: newId };
  delete nodes[oldId];

  // update connections
  state.connections.forEach(c => {
    if (c.from === oldId) c.from = newId;
    if (c.to === oldId) c.to = newId;
  });

  // update next references
  Object.values(nodes).forEach(n => {
    if (n.id !== newId) {
      if (n.next === oldId) n.next = newId;
      if (n.secret && n.secret.next === oldId) n.secret.next = newId;
      n.choices && n.choices.forEach(c => { if (c.next === oldId) c.next = newId; });
    }
  });

  const el = document.getElementById('node-' + oldId);
  if (el) { el.id = 'node-' + newId; }
  state.selectedNodes.delete(oldId);
  state.selectedNodes.add(newId);
  state.selectedNode = newId;
  updateNodeEl(newId);
  renderConnections();
  renderSidebar();
}

// ================================
// CHOICES
// ================================
export function addChoice() {
  if (!state.selectedNode || !state.nodes[state.selectedNode]) return;
  pushHistory();
  state.nodes[state.selectedNode].choices.push(createChoice(state.mode));
  renderSidebar();
  updateNodeEl(state.selectedNode);
  markDirty();
}

// Called with the clicked "×" button (via data-action).
export function removeChoice(btn) {
  if (!state.selectedNode || !state.nodes[state.selectedNode]) return;
  const i = Number(btn.closest('.choice-item').dataset.index);
  pushHistory();
  state.nodes[state.selectedNode].choices.splice(i, 1);
  renderSidebar();
  updateNodeEl(state.selectedNode);
  markDirty();
}

function updateChoice(i, key, val) {
  if (!state.selectedNode || !state.nodes[state.selectedNode]) return;
  state.nodes[state.selectedNode].choices[i][key] = val;
  updateNodeEl(state.selectedNode);
  markDirty();
}
