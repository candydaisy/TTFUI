// ================================
// I/O: export, import, autosave, share links
// ================================
import { state } from './state.js';
import { showToast } from './utils.js';
import {
  buildExportData, extractDictBody, parseFlowGraph, buildConnections,
  encodeShareCode, decodeShareCode
} from './graph.js';
import { pushHistory, clearHistory } from './history.js';
import {
  rebuildNodeElements, applyTransform, renderConnections, updateSelectionVisuals,
  updateEmptyHint, setSelection
} from './canvas.js';
import { renderSidebar } from './sidebar.js';
import { runDiagnostics } from './diagnostics.js';
import { applyLayout } from './nodes.js';

// Close a modal when its dim backdrop (not the dialog itself) is clicked.
function closeOnBackdrop(overlayId, close) {
  const overlay = document.getElementById(overlayId);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

export function setupIOEvents() {
  closeOnBackdrop('modal-overlay', closeModal);
  closeOnBackdrop('import-overlay', closeImport);
  closeOnBackdrop('share-overlay', closeShareModal);

  document.getElementById('import-file-input').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (file) loadJSONFile(file);
  });

  const area = document.getElementById('import-code');
  area.addEventListener('dragover', e => {
    e.preventDefault();
    area.style.borderColor = 'var(--accent)';
  });
  area.addEventListener('dragleave', () => {
    area.style.borderColor = 'var(--border)';
  });
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.style.borderColor = 'var(--border)';
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      loadJSONFile(e.dataTransfer.files[0]);
    }
  });
}

// Show a short confirmation on a button, then restore its label.
function flashButton(btn, text, restoreTo = btn.textContent) {
  btn.textContent = text;
  setTimeout(() => { btn.textContent = restoreTo; }, 1500);
}

// ================================
// EXPORT (JSON)
// ================================
export function exportCode() {
  document.getElementById('output-code').value = JSON.stringify(buildExportData(state), null, 2);
  const hintEl = document.getElementById('export-browser-hint');
  if (hintEl) {
    hintEl.style.display = (!window.showSaveFilePicker) ? 'block' : 'none';
  }
  const saveAsBtn = document.getElementById('modal-save-as-btn');
  if (saveAsBtn && !window.showSaveFilePicker) {
    saveAsBtn.title = "Downloads file. In Firefox, turn on 'Always ask you where to save files' in Settings to choose folders.";
  }
  document.getElementById('modal-overlay').classList.add('active');
}

export function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

// Lets the user pick exactly where the exported JSON is saved.
// Uses the native "Save As" file picker where supported (Chrome/Edge),
// and falls back to a normal browser download otherwise.
export async function saveCodeToFile(btn, forceSaveAs = true) {
  const code = document.getElementById('output-code').value;
  let filename = document.getElementById('export-filename') ? document.getElementById('export-filename').value.trim() : 'flow_graph.json';
  if (!filename) filename = 'flow_graph.json';
  if (!filename.toLowerCase().endsWith('.json')) filename += '.json';

  if (forceSaveAs && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON file (*.json)', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(code);
      await writable.close();
      if (btn) flashButton(btn, '✓ Saved!');
      showToast('Saved to ' + handle.name);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user cancelled the picker
      console.warn('showSaveFilePicker error:', err);
    }
  }

  // Fallback / standard download:
  const blob = new Blob([code], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  if (btn) flashButton(btn, '✓ Saved!');
  if (!window.showSaveFilePicker) {
    showToast(`Saved ${filename}. (Tip: Enable "Always ask where to save" in Firefox Settings)`);
  } else {
    showToast('Downloaded ' + filename);
  }
}

export function copyCode(btn) {
  const ta = document.getElementById('output-code');
  ta.select();
  navigator.clipboard.writeText(ta.value).then(() => flashButton(btn, '✓ Copied!', 'Copy to Clipboard'));
}

// ================================
// AUTO SAVE / LOAD
// ================================
const SAVE_KEY = 'flow_editor_autosave';
let saveTimeout = null;

export function markDirty() {
  setSaveStatus('unsaved', '● unsaved');
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveToStorage, 1500); // save 1.5s after last change
  runDiagnostics();
}

function saveToStorage() {
  try {
    const { nodes, connections, pan, zoom, nextId } = state;
    localStorage.setItem(SAVE_KEY, JSON.stringify({ nodes, connections, pan, zoom, nextId, savedAt: Date.now() }));
    setSaveStatus('saved', '⬤ saved');
  } catch (e) {
    setSaveStatus('error', '⚠ save failed');
  }
}

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.nodes || !Object.keys(data.nodes).length) return false;

    state.nodes = data.nodes;
    state.connections = data.connections || [];
    state.pan = data.pan || { x: 60, y: 60 };
    state.zoom = data.zoom || 1;
    state.nextId = data.nextId || 1;
    setSelection([]);

    clearHistory();
    rebuildNodeElements();
    applyTransform();
    renderConnections();
    updateEmptyHint();

    const ago = Math.round((Date.now() - data.savedAt) / 1000);
    const agoStr = ago < 60 ? `${ago}s ago` : ago < 3600 ? `${Math.round(ago/60)}m ago` : 'a while ago';
    setSaveStatus('saved', `⬤ restored (${agoStr})`);
    setTimeout(() => setSaveStatus('saved', '⬤ saved'), 3000);
    return true;
  } catch (e) {
    return false;
  }
}

function setSaveStatus(status, text) {
  const el = document.getElementById('save-status');
  el.textContent = text;
  el.style.color = status === 'saved' ? 'var(--success)' : status === 'unsaved' ? 'var(--warning)' : 'var(--danger)';
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
  setSaveStatus('saved', '⬤ cleared');
}

// ================================
// IMPORT (JSON / GDScript)
// ================================
export function openImport() {
  document.getElementById('import-overlay').style.display = 'flex';
  document.getElementById('import-code').value = '';
  document.getElementById('import-error').style.display = 'none';
  clearImportFile();
}

export function closeImport() {
  document.getElementById('import-overlay').style.display = 'none';
  clearImportFile();
}

export function pickImportFile() {
  document.getElementById('import-file-input').click();
}

function loadJSONFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('import-code').value = e.target.result;
    const statusEl = document.getElementById('import-file-status');
    document.getElementById('import-file-name').textContent = `✓ Loaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    statusEl.style.display = 'flex';
    document.getElementById('import-error').style.display = 'none';
    showToast(`Loaded ${file.name}`);
  };
  reader.readAsText(file);
}

export function clearImportFile() {
  document.getElementById('import-file-input').value = '';
  document.getElementById('import-file-status').style.display = 'none';
}

export function runImport() {
  const raw = document.getElementById('import-code').value.trim();
  document.getElementById('import-error').style.display = 'none';

  if (!raw) { showImportError('Nothing pasted.'); return; }

  const body = extractDictBody(raw);
  if (body === null) { showImportError('Could not find a { } block.'); return; }

  let parsed;
  try {
    parsed = parseFlowGraph(body);
  } catch (e) {
    showImportError('Parse error: ' + e.message + '. Make sure you pasted the full flow_graph block.');
    return;
  }

  pushHistory();
  state.nodes = parsed.nodes;
  state.nextId = parsed.nextId;
  state.connections = buildConnections(state.nodes);
  setSelection([]);

  rebuildNodeElements();
  // auto layout since we have no position data
  applyLayout();
  renderSidebar();
  updateEmptyHint();
  closeImport();
  markDirty();
}

function showImportError(msg) {
  const el = document.getElementById('import-error');
  el.textContent = msg;
  el.style.display = 'block';
}

// ================================
// SHARE - URL & CLIPBOARD
// ================================
export function openShareModal() {
  const code = encodeShareCode({ nodes: state.nodes, connections: state.connections, nextId: state.nextId });
  document.getElementById('share-code-area').value = code;

  // URL: current page URL + #share=<code>
  const base = window.location.href.split('#')[0];
  document.getElementById('share-url-input').value = base + '#share=' + code;

  // clear load area & error
  document.getElementById('load-code-area').value = '';
  document.getElementById('share-load-error').style.display = 'none';

  document.getElementById('share-overlay').style.display = 'flex';
}

export function closeShareModal() {
  document.getElementById('share-overlay').style.display = 'none';
}

export function copyShareUrl() {
  const val = document.getElementById('share-url-input').value;
  navigator.clipboard.writeText(val).then(() => flashButton(document.getElementById('copy-url-btn'), '✓ Copied!', 'Copy'));
}

export function copyShareCode() {
  const val = document.getElementById('share-code-area').value;
  navigator.clipboard.writeText(val).then(() => flashButton(document.getElementById('copy-code-btn'), '✓ Copied!', 'Copy Code'));
}

export function loadShareCode() {
  const raw = document.getElementById('load-code-area').value.trim();
  const errEl = document.getElementById('share-load-error');
  errEl.style.display = 'none';
  if (!raw) { errEl.textContent = 'Paste a share code first.'; errEl.style.display = 'block'; return; }
  try {
    const data = decodeShareCode(raw);
    if (!data.nodes) throw new Error('Invalid share code.');
    applyShareData(data);
    closeShareModal();
  } catch (e) {
    errEl.textContent = 'Invalid share code: ' + e.message;
    errEl.style.display = 'block';
  }
}

function applyShareData(data) {
  pushHistory();
  state.nodes = data.nodes || {};
  state.connections = data.connections || [];
  state.nextId = data.nextId || 1;
  setSelection([]);
  rebuildNodeElements();
  updateSelectionVisuals();
  renderConnections();
  renderSidebar();
  updateEmptyHint();
  markDirty();
}

// Load a graph from a #share=<code> URL hash, if present.
export function loadShareFromURL() {
  const hash = window.location.hash;
  if (!hash.startsWith('#share=')) return;
  try {
    const data = decodeShareCode(hash.slice(7));
    if (data.nodes) {
      // don't silently overwrite the user's autosaved work
      const existing = Object.keys(state.nodes).length;
      const incoming = Object.keys(data.nodes).length;
      const ok = !existing || confirm(
        `This link contains a shared graph (${incoming} node${incoming === 1 ? '' : 's'}).\n\n` +
        `Loading it will replace your current graph (${existing} node${existing === 1 ? '' : 's'}). ` +
        `Export your work first if you want to keep it.\n\nLoad the shared graph?`
      );
      if (ok) applyShareData(data);
    }
    // clean the hash from the URL without reloading
    history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch (e) { /* malformed hash, just ignore */ }
}
