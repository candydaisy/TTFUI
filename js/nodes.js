// ================================
// NODE OPERATIONS: add / delete / copy / paste / duplicate / layout
// ================================
import { state, genId, lastSelectedId, selectedIds } from './state.js';
import { showToast } from './utils.js';
import { createNode, remapRefs, remapConnections, computeLayout, buildConnections, exampleGraph } from './graph.js';
import { pushHistory } from './history.js';
import {
  createNodeEl, updateNodeEl, rebuildNodeElements, renderConnections, selectNode,
  setSelection, updateSelectionVisuals, updateEmptyHint, screenToCanvas
} from './canvas.js';
import { renderSidebar } from './sidebar.js';
import { runDiagnostics } from './diagnostics.js';
import { markDirty, clearSave, setMode } from './io.js';

// Refresh everything after nodes were added/removed.
function afterStructureChange() {
  updateSelectionVisuals();
  renderConnections();
  renderSidebar();
  updateEmptyHint();
  runDiagnostics();
  markDirty();
}

function plural(n) { return `${n} node${n > 1 ? 's' : ''}`; }

// ================================
// ADD
// ================================
// (clientX, clientY) is a screen position; omitted = center of the view.
export function addNode(clientX, clientY) {
  pushHistory();
  let x, y;
  if (clientX === undefined) {
    const rect = document.getElementById('canvas-wrap').getBoundingClientRect();
    x = (rect.width / 2 - state.pan.x) / state.zoom;
    y = (rect.height / 2 - state.pan.y) / state.zoom;
  } else {
    ({ x, y } = screenToCanvas(clientX, clientY));
  }

  const id = genId();
  state.nodes[id] = createNode(id, x, y);

  createNodeEl(id);
  renderConnections();
  selectNode(id);
  updateEmptyHint();
  markDirty();
}

// ================================
// DELETE
// ================================
function removeNode(id) {
  const el = document.getElementById('node-' + id);
  if (el) el.remove();
  delete state.nodes[id];
  state.connections = state.connections.filter(c => c.from !== id && c.to !== id);
}

export function deleteSelectedNodes() {
  const ids = selectedIds();
  if (ids.length === 0) return;

  pushHistory();
  ids.forEach(removeNode);
  setSelection([]);
  afterStructureChange();
  showToast(`Deleted ${plural(ids.length)}`);
}

export function deleteNode(id) {
  if (!id || !state.nodes[id]) return;
  pushHistory();
  removeNode(id);
  state.selectedNodes.delete(id);
  if (state.selectedNode === id) state.selectedNode = lastSelectedId();
  afterStructureChange();
}

// ================================
// COPY / PASTE / DUPLICATE
// ================================
function setClipboard(nodes, connections) {
  state.clipboard = { nodes, connections };
  const pasteItem = document.getElementById('ctx-paste');
  if (pasteItem) pasteItem.style.display = 'block';
}

export function copySelectedNodes() {
  const ids = selectedIds();
  if (ids.length === 0) return;

  const idSet = new Set(ids);
  setClipboard(
    ids.map(id => JSON.parse(JSON.stringify(state.nodes[id]))),
    state.connections.filter(c => idSet.has(c.from) && idSet.has(c.to)).map(c => ({ ...c }))
  );
  showToast(`Copied ${plural(ids.length)}`);
}

export function copyNode(id) {
  const targetId = id || state.selectedNode;
  if (!targetId || !state.nodes[targetId]) return;
  if (state.selectedNodes.size > 1 && state.selectedNodes.has(targetId)) {
    copySelectedNodes();
    return;
  }
  setClipboard([JSON.parse(JSON.stringify(state.nodes[targetId]))], []);
  showToast('Copied node ' + targetId);
}

// Insert copies of srcNodes (and the connections between them), shifted by
// offset(src) -> {x, y}. Returns the new IDs.
function insertCopies(srcNodes, srcConnections, offset) {
  const idMap = {};
  srcNodes.forEach(src => { idMap[src.id] = genId(); });

  const newIds = srcNodes.map(src => {
    const newId = idMap[src.id];
    const newNode = remapRefs(JSON.parse(JSON.stringify(src)), idMap);
    newNode.id = newId;
    Object.assign(newNode, offset(src));
    state.nodes[newId] = newNode;
    createNodeEl(newId);
    return newId;
  });

  state.connections.push(...remapConnections(srcConnections, idMap));
  return newIds;
}

export function duplicateSelectedNodes() {
  const ids = selectedIds().filter(id => state.nodes[id]);
  if (ids.length === 0) return;

  pushHistory();
  const newIds = insertCopies(ids.map(id => state.nodes[id]), state.connections, src => ({ x: src.x + 40, y: src.y + 40 }));
  setSelection(newIds);
  afterStructureChange();
  showToast(`Duplicated ${plural(newIds.length)}`);
}

export function duplicateNode(id) {
  const targetId = id || state.selectedNode;
  if (!targetId || !state.nodes[targetId]) return;
  if (state.selectedNodes.size > 1 && state.selectedNodes.has(targetId)) {
    duplicateSelectedNodes();
    return;
  }
  pushHistory();
  const [newId] = insertCopies([state.nodes[targetId]], [], src => ({ x: src.x + 30, y: src.y + 30 }));
  selectNode(newId);
  renderConnections();
  updateEmptyHint();
  runDiagnostics();
  markDirty();
  showToast('Duplicated to node ' + newId);
}

// (clientX, clientY) is a screen position; omitted = offset from the originals.
export function pasteNode(clientX, clientY) {
  const clip = state.clipboard;
  if (!clip || !clip.nodes || clip.nodes.length === 0) return;

  pushHistory();

  let minX = Infinity, minY = Infinity;
  clip.nodes.forEach(n => {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
  });

  const target = (clientX !== undefined && clientY !== undefined)
    ? screenToCanvas(clientX, clientY)
    : { x: minX + 40, y: minY + 40 };
  const offsetX = target.x - minX;
  const offsetY = target.y - minY;

  const newIds = insertCopies(clip.nodes, clip.connections || [], src => ({
    x: Math.max(0, Math.round(src.x + offsetX)),
    y: Math.max(0, Math.round(src.y + offsetY))
  }));
  setSelection(newIds);
  afterStructureChange();
  showToast(`Pasted ${plural(newIds.length)}`);
}

// ================================
// CLEAR
// ================================
export function clearAll() {
  if (!confirm('Clear everything? This will also clear the auto-save.')) return false;
  pushHistory();
  state.nodes = {};
  state.connections = [];
  state.characters = [];
  setSelection([]);
  state.nextId = 1;
  rebuildNodeElements();
  renderConnections(); renderSidebar(); updateEmptyHint();
  clearSave();
  return true;
}

// ================================
// AUTO LAYOUT
// ================================
// Move nodes to computed positions (no history entry).
export function applyLayout() {
  const positions = computeLayout(state);
  Object.entries(positions).forEach(([id, pos]) => {
    Object.assign(state.nodes[id], pos);
    updateNodeEl(id);
  });
  renderConnections();
}

export function autoLayout() {
  if (!Object.keys(state.nodes).length) return;
  pushHistory();
  applyLayout();
}

// ================================
// LOAD EXAMPLE
// ================================
export function loadExample() {
  if (!clearAll()) return;
  const example = exampleGraph();
  state.nodes = example.nodes;
  state.nextId = example.nextId;
  state.characters = example.characters;
  setMode(example.mode);
  state.connections = buildConnections(state.nodes);
  rebuildNodeElements();
  renderConnections();
  updateEmptyHint();
  markDirty();
}
