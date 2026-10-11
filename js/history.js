// ================================
// UNDO / REDO SYSTEM
// ================================
import { state, lastSelectedId } from './state.js';
import { showToast } from './utils.js';
import { rebuildNodeElements, updateSelectionVisuals, renderConnections, updateEmptyHint } from './canvas.js';
import { renderSidebar } from './sidebar.js';
import { runDiagnostics } from './diagnostics.js';
import { markDirty } from './io.js';

const MAX_HISTORY = 50;
let undoStack = [];
let redoStack = [];
let fieldFocusSnapshot = null;

export function getSnapshot() {
  return {
    nodes: JSON.parse(JSON.stringify(state.nodes)),
    connections: JSON.parse(JSON.stringify(state.connections)),
    nextId: state.nextId,
    selectedNodeIds: Array.from(state.selectedNodes)
  };
}

export function pushHistory() {
  commitSnapshot(getSnapshot());
}

// Record a snapshot taken earlier (at drag start / field focus) as one undo step.
export function commitSnapshot(snapshot) {
  redoStack.length = 0;
  undoStack.push(snapshot);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  updateUndoRedoUI();
}

export function clearHistory() {
  undoStack = [];
  redoStack = [];
  updateUndoRedoUI();
}

export function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(getSnapshot());
  applySnapshot(undoStack.pop());
  showToast('Undo');
}

export function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(getSnapshot());
  applySnapshot(redoStack.pop());
  showToast('Redo');
}

export function updateUndoRedoUI() {
  const uBtn = document.getElementById('undo-btn');
  const rBtn = document.getElementById('redo-btn');
  if (uBtn) uBtn.disabled = undoStack.length === 0;
  if (rBtn) rBtn.disabled = redoStack.length === 0;
}

function applySnapshot(snapshot) {
  state.nodes = JSON.parse(JSON.stringify(snapshot.nodes || {}));
  state.connections = JSON.parse(JSON.stringify(snapshot.connections || []));
  state.nextId = snapshot.nextId || state.nextId;
  state.selectedNodes = new Set(snapshot.selectedNodeIds || []);
  state.selectedNode = lastSelectedId();

  rebuildNodeElements();
  updateSelectionVisuals();
  renderConnections();
  renderSidebar();
  updateEmptyHint();
  runDiagnostics();
  markDirty();
  updateUndoRedoUI();
}

// Sidebar edits are recorded as one undo step per field focus, not per keystroke.
export function setupSidebarHistoryEvents() {
  const sidebar = document.getElementById('sidebar-content');
  if (!sidebar) return;

  const commitIfChanged = () => {
    if (JSON.stringify(state.nodes) !== JSON.stringify(fieldFocusSnapshot.nodes)) {
      commitSnapshot(fieldFocusSnapshot);
    }
  };

  sidebar.addEventListener('focusin', e => {
    if (e.target.matches('input, textarea, select')) {
      fieldFocusSnapshot = getSnapshot();
    }
  });

  sidebar.addEventListener('focusout', e => {
    if (e.target.matches('input, textarea, select') && fieldFocusSnapshot) {
      commitIfChanged();
      fieldFocusSnapshot = null;
    }
  });

  sidebar.addEventListener('change', e => {
    if (e.target.matches('select') && fieldFocusSnapshot) {
      commitIfChanged();
      fieldFocusSnapshot = getSnapshot();
    }
  });
}
