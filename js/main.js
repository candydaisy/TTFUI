// ================================
// ENTRY POINT: wiring, actions, keyboard shortcuts
// ================================
import { state, hasSelection } from './state.js';
import { undo, redo, updateUndoRedoUI, setupFieldHistory } from './history.js';
import {
  drawGrid, applyTransform, setupCanvasEvents, zoomIn, zoomOut, resetZoom, selectAllNodes,
  hideCtxMenu, updateEmptyHint,
  ctxAddNode, ctxPasteNode, ctxPlayNode, ctxDeleteNode, ctxCopyNode, ctxDuplicateNode
} from './canvas.js';
import {
  addNode, deleteSelectedNodes, copyNode, copySelectedNodes, duplicateNode, duplicateSelectedNodes,
  pasteNode, clearAll, autoLayout, loadExample
} from './nodes.js';
import { setupSidebarEvents, addChoice, removeChoice } from './sidebar.js';
import { setupMinimap, toggleMinimap } from './minimap.js';
import {
  setupCharactersEvents, openCharacters, closeCharacters, addCharacter, removeCharacter, detectCharactersFromStory
} from './characters.js';
import { setupSearchEvents, openSearch, closeSearch, searchNext, searchPrev } from './search.js';
import {
  setupDiagnosticsEvents, runDiagnostics, toggleDiagnostics, closeDiagnostics, filterDiag, isDiagnosticsOpen
} from './diagnostics.js';
import {
  setupPlaytestEvents, isPlaytestOpen, openPlaytest, closePlaytest, restartPlaytest, playtestNext, togglePlaytestLang, togglePlaytestDebug
} from './playtest.js';
import {
  setupIOEvents, setupModeSelect, exportCode, closeModal, saveCodeToFile, copyCode, loadFromStorage,
  openImport, closeImport, pickImportFile, clearImportFile, runImport,
  openShareModal, closeShareModal, copyShareUrl, copyShareCode, loadShareCode, loadShareFromURL
} from './io.js';

// ================================
// ACTIONS
// ================================
// Buttons declare what they do with data-action="name" (and optionally
// data-arg="..."); one delegated click listener dispatches to this table.
// Each handler receives the clicked element.
const ACTIONS = {
  // toolbar
  addNode: () => addNode(),
  undo: () => undo(),
  redo: () => redo(),
  autoLayout: () => autoLayout(),
  openSearch: () => openSearch(),
  zoomIn: () => zoomIn(),
  zoomOut: () => zoomOut(),
  resetZoom: () => resetZoom(),
  toggleMinimap: () => toggleMinimap(),
  clearAll: () => clearAll(),
  toggleDiagnostics: () => toggleDiagnostics(),
  openShareModal: () => openShareModal(),
  openCharacters: () => openCharacters(),
  openPlaytest: () => openPlaytest(),
  loadExample: () => loadExample(),
  openImport: () => openImport(),
  exportCode: () => exportCode(),

  // search bar
  searchPrev: () => searchPrev(),
  searchNext: () => searchNext(),
  closeSearch: () => closeSearch(),

  // context menu
  ctxAddNode: () => ctxAddNode(),
  ctxPasteNode: () => ctxPasteNode(),
  ctxPlayNode: () => ctxPlayNode(),
  ctxDuplicateNode: () => ctxDuplicateNode(),
  ctxCopyNode: () => ctxCopyNode(),
  ctxDeleteNode: () => ctxDeleteNode(),

  // sidebar
  duplicateNode: () => duplicateNode(state.selectedNode),
  copyNode: () => copyNode(state.selectedNode),
  duplicateSelectedNodes: () => duplicateSelectedNodes(),
  copySelectedNodes: () => copySelectedNodes(),
  deleteSelectedNodes: () => deleteSelectedNodes(),
  addChoice: () => addChoice(),
  removeChoice: el => removeChoice(el),

  // export modal
  closeModal: () => closeModal(),
  downloadExport: el => saveCodeToFile(el, false),
  saveExportAs: el => saveCodeToFile(el, true),
  copyCode: el => copyCode(el),

  // import modal
  closeImport: () => closeImport(),
  pickImportFile: () => pickImportFile(),
  clearImportFile: () => clearImportFile(),
  runImport: () => runImport(),

  // share modal
  closeShareModal: () => closeShareModal(),
  copyShareUrl: () => copyShareUrl(),
  copyShareCode: () => copyShareCode(),
  loadShareCode: () => loadShareCode(),

  // characters window
  closeCharacters: () => closeCharacters(),
  addCharacter: () => addCharacter(),
  removeCharacter: el => removeCharacter(el),
  detectCharacters: () => detectCharactersFromStory(),

  // diagnostics
  closeDiagnostics: () => closeDiagnostics(),
  filterDiag: el => filterDiag(el.dataset.arg),

  // playtest
  restartPlaytest: () => restartPlaytest(),
  togglePlaytestLang: el => togglePlaytestLang(el),
  togglePlaytestDebug: () => togglePlaytestDebug(),
  closePlaytest: () => closePlaytest(),
  playtestNext: () => playtestNext(),
};

function setupActions() {
  document.addEventListener('click', e => {
    // a menu closes on a click outside it or on one of its items
    document.querySelectorAll('.tb-menu[open]').forEach(menu => {
      if (!menu.contains(e.target) || e.target.closest('.tb-menu-list [data-action], .tb-menu-list a')) menu.open = false;
    });
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = ACTIONS[el.dataset.action];
    if (action) action(el);
    else console.warn('Unknown data-action:', el.dataset.action);
  });
}

// ================================
// KEYBOARD SHORTCUTS
// ================================
const isCtrl = (e, key) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === key;

function isTypingTarget() {
  const activeEl = document.activeElement;
  return activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
}

function onEditorKeydown(e) {
  if (e.key === 'Escape') {
    closeModal();
    hideCtxMenu();
    closeShareModal();
    closeCharacters();
    closeSearch();
    return;
  }

  // Ctrl+Z -> Undo, Ctrl+Y / Ctrl+Shift+Z -> Redo
  if (isCtrl(e, 'z') && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (isCtrl(e, 'y') || (isCtrl(e, 'z') && e.shiftKey)) { e.preventDefault(); redo(); return; }

  if (isCtrl(e, 'a')) { e.preventDefault(); selectAllNodes(); return; }
  if (isCtrl(e, 's')) { e.preventDefault(); exportCode(); return; }
  if (isCtrl(e, 'f')) { e.preventDefault(); openSearch(); return; }

  // While typing inside text inputs / textareas:
  if (isTypingTarget()) {
    // Inside the search input specifically, Enter and Shift+Enter navigate
    if (document.activeElement.id === 'search-input' && e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) searchPrev();
      else searchNext();
    }
    // Otherwise let normal browser text selection, typing, copy, paste occur
    return;
  }

  if (isCtrl(e, 'c')) {
    if (hasSelection()) { e.preventDefault(); copySelectedNodes(); }
    return;
  }
  if (isCtrl(e, 'v')) {
    if (state.clipboard) { e.preventDefault(); pasteNode(); }
    return;
  }
  if (isCtrl(e, 'd')) {
    if (hasSelection()) { e.preventDefault(); duplicateSelectedNodes(); }
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && hasSelection()) {
    e.preventDefault();
    deleteSelectedNodes();
  }
}

function onOverlayKeydown(e) {
  if (isPlaytestOpen()) {
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
      const activeTagName = document.activeElement ? document.activeElement.tagName : '';
      if (activeTagName !== 'BUTTON') {
        e.preventDefault();
        playtestNext();
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closePlaytest();
    }
    return;
  }

  if (isDiagnosticsOpen() && e.key === 'Escape') {
    e.preventDefault();
    closeDiagnostics();
    return;
  }

  if (!isTypingTarget() && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    openPlaytest();
  }
}

// ================================
// INIT
// ================================
// Module scripts run after the document is parsed, so the DOM is ready here.
drawGrid();
applyTransform();
setupCanvasEvents();
setupSearchEvents();
setupFieldHistory('sidebar-content');
setupFieldHistory('characters-list');
setupSidebarEvents();
setupCharactersEvents();
setupMinimap();
setupDiagnosticsEvents();
setupPlaytestEvents();
setupIOEvents();
setupModeSelect();
setupActions();
window.addEventListener('keydown', onEditorKeydown);
window.addEventListener('keydown', onOverlayKeydown);

if (!loadFromStorage()) updateEmptyHint();
runDiagnostics();
updateUndoRedoUI();
loadShareFromURL();
