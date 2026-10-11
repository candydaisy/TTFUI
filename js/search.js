// ================================
// SEARCH (Ctrl+F)
// ================================
import { state } from './state.js';
import { nodeMatchesQuery } from './graph.js';
import { centerOnNode, clearHighlight } from './canvas.js';

let searchResults = [];
let searchIndex = -1;

export function setupSearchEvents() {
  document.getElementById('search-input').addEventListener('input', runSearch);
}

export function openSearch() {
  const bar = document.getElementById('search-bar');
  const input = document.getElementById('search-input');
  if (!bar || !input) return;
  bar.style.display = 'flex';
  input.focus();
  input.select();
  runSearch();
}

export function closeSearch() {
  const bar = document.getElementById('search-bar');
  if (bar) bar.style.display = 'none';
  clearHighlight();
}

function updateCount() {
  const countEl = document.getElementById('search-count');
  if (countEl) countEl.textContent = searchResults.length ? `${searchIndex + 1}/${searchResults.length}` : '0/0';
}

function runSearch() {
  const input = document.getElementById('search-input');
  const query = (input ? input.value : '').trim().toLowerCase();
  searchResults = query ? Object.keys(state.nodes).filter(id => nodeMatchesQuery(state.nodes[id], query)) : [];
  searchIndex = searchResults.length ? 0 : -1;
  updateCount();

  if (searchResults.length) centerOnNode(searchResults[0]);
  else clearHighlight();
}

function step(dir) {
  if (!searchResults.length) return;
  searchIndex = (searchIndex + dir + searchResults.length) % searchResults.length;
  updateCount();
  centerOnNode(searchResults[searchIndex]);
}

export function searchNext() { step(1); }
export function searchPrev() { step(-1); }
