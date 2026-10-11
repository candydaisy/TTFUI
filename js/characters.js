// ================================
// CHARACTER PRESETS WINDOW
// ================================
import { state } from './state.js';
import { escapeHTML, showToast } from './utils.js';
import {
  splitList, findCharacter, nextCharacterColor, detectCharacters, renameCharacterRefs, speakerLineCounts
} from './graph.js';
import { pushHistory } from './history.js';
import { updateNodeEl, renderConnections } from './canvas.js';
import { renderSidebar } from './sidebar.js';
import { markDirty } from './io.js';

export function setupCharactersEvents() {
  const list = document.getElementById('characters-list');
  const overlay = document.getElementById('characters-overlay');
  overlay.addEventListener('click', e => { if (e.target === overlay) closeCharacters(); });

  // color + emotions update live; names are committed on change (blur / Enter)
  // because renaming also rewrites every reference in the story.
  list.addEventListener('input', e => {
    const ch = characterFor(e.target);
    if (!ch) return;
    if (e.target.classList.contains('character-color')) ch.color = e.target.value;
    else if (e.target.classList.contains('character-emotions')) ch.emotions = splitList(e.target.value);
    else return;
    refreshViews();
  });

  list.addEventListener('change', e => {
    if (e.target.classList.contains('character-name')) commitName(e.target);
  });

  list.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input')) e.target.blur();
  });
}

function characterFor(el) {
  const row = el.closest('.character-row');
  return row ? state.characters[Number(row.dataset.index)] : null;
}

export function openCharacters() {
  renderCharacterList();
  document.getElementById('characters-overlay').style.display = 'flex';
}

export function closeCharacters() {
  document.getElementById('characters-overlay').style.display = 'none';
}

export function isCharactersOpen() {
  return document.getElementById('characters-overlay').style.display === 'flex';
}

export function renderCharacterList() {
  const list = document.getElementById('characters-list');
  if (!list) return;

  if (!state.characters.length) {
    list.innerHTML = `<div class="characters-empty">
      No characters yet. Add one, or use <strong>Detect from Story</strong> to create them from the speakers you've already written.
    </div>`;
    return;
  }

  const counts = speakerLineCounts(state.nodes);
  list.innerHTML = state.characters.map((c, i) => `
    <div class="character-row" data-index="${i}">
      <input type="color" class="character-color" value="${escapeHTML(c.color)}" title="Speaker color">
      <input class="field-input character-name" value="${escapeHTML(c.name)}" placeholder="Name" spellcheck="false">
      <input class="field-input character-emotions" value="${escapeHTML(c.emotions.join(', '))}" placeholder="Emotions, e.g. happy, sad (empty = defaults)">
      <span class="character-usage" title="Lines spoken">${usageLabel(counts[c.name] || 0)}</span>
      <button class="choice-remove" data-action="removeCharacter" title="Remove preset (lines keep their speaker)">×</button>
    </div>
  `).join('');
}

function usageLabel(count) {
  return `${count} line${count === 1 ? '' : 's'}`;
}

// Re-render everything that shows character colors / emotion lists.
function refreshViews() {
  Object.keys(state.nodes).forEach(updateNodeEl);
  renderConnections();
  renderSidebar();
  markDirty();
}

export function addCharacter() {
  pushHistory();
  let name = 'New Character';
  for (let i = 2; findCharacter(state.characters, name); i++) name = `New Character ${i}`;
  state.characters.push({ name, color: nextCharacterColor(state.characters), emotions: [] });
  renderCharacterList();
  refreshViews();
  const inputs = document.querySelectorAll('#characters-list .character-name');
  const input = inputs[inputs.length - 1];
  input.focus();
  input.select();
}

// Called with the clicked "×" button (via data-action).
export function removeCharacter(btn) {
  const row = btn.closest('.character-row');
  pushHistory();
  state.characters.splice(Number(row.dataset.index), 1);
  renderCharacterList();
  refreshViews();
}

export function detectCharactersFromStory() {
  const before = state.characters.length;
  const detected = detectCharacters(state.nodes, state.characters);
  if (JSON.stringify(detected) === JSON.stringify(state.characters)) {
    showToast('No new characters or emotions found');
    return;
  }
  pushHistory();
  state.characters = detected;
  renderCharacterList();
  refreshViews();
  const added = detected.length - before;
  showToast(added ? `Added ${added} character${added > 1 ? 's' : ''}` : 'Added missing emotions');
}

function commitName(input) {
  const ch = characterFor(input);
  if (!ch) return;
  const newName = input.value.trim();
  if (newName === ch.name) { input.value = ch.name; return; }
  if (!newName) { input.value = ch.name; return; }
  if (findCharacter(state.characters, newName)) {
    alert(`A character named "${newName}" already exists.`);
    input.value = ch.name;
    return;
  }
  const oldName = ch.name;
  ch.name = newName;
  const changed = renameCharacterRefs(state.nodes, oldName, newName);
  // update in place: re-rendering the list would drop focus without a
  // focusout event, and the field history would never record this edit
  input.value = newName;
  input.closest('.character-row').querySelector('.character-usage').textContent =
    usageLabel(speakerLineCounts(state.nodes)[newName] || 0);
  refreshViews();
  if (changed) showToast(`Renamed ${oldName} → ${newName} in ${changed} node${changed > 1 ? 's' : ''}`);
}
