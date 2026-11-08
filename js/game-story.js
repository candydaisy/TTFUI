// ================================
// GAME STORY: open the game's stories straight from its folder
// ================================
// Running locally (npm start), the helper serves the game's stories and saved
// voice files at /api/project. Offer them in the toolbar, open one when the
// editor is empty, and tag the nodes that already have a voice file. On the
// website there's no helper, so the menu stays hidden and Import works as before.
import { state } from './state.js';
import { loadGameStory } from './io.js';
import { rebuildNodeElements } from './canvas.js';
import { escapeHTML, showToast } from './utils.js';

const GAME_DIR_KEY = 'ttfui_game_dir'; // the folder chosen on the Voice page, if any

export async function setupGameStory() {
  let routes;
  try {
    let dir = '';
    try { dir = localStorage.getItem(GAME_DIR_KEY) || ''; } catch { /* storage blocked */ }
    const res = await fetch('/api/project', { headers: dir ? { 'X-Game-Dir': encodeURIComponent(dir) } : {} });
    if (!res.ok) return;
    routes = (await res.json()).routes || [];
  } catch {
    return; // opened as a file or a static site: no helper
  }
  if (!routes.length) return;

  const select = document.getElementById('game-story-select');
  select.innerHTML = '<option value="">Game story…</option>'
    + routes.map(r => `<option value="${escapeHTML(r.name)}">${escapeHTML(r.name)}</option>`).join('');
  select.hidden = false;

  const open = name => {
    loadGameStory(routes.find(r => r.name === name));
    select.value = name;
  };
  select.addEventListener('change', () => {
    const name = select.value;
    if (!name) return;
    if (Object.keys(state.nodes).length && !confirm(`Replace what's in the editor with the game's ${name} story? (Undo brings it back.)`)) {
      select.value = state.gameRoute;
      return;
    }
    open(name);
  });

  if (!Object.keys(state.nodes).length) {
    open(routes[0].name);
    return;
  }
  // the autosave is kept (it may hold unsaved edits); still tag its voiced lines
  const route = routes.find(r => r.name === state.gameRoute);
  if (route) {
    state.voiceFiles = new Set(route.files);
    rebuildNodeElements();
    showToast(`Restored your ${route.name} edits. Pick ${route.name} under Game story to reload the game's copy.`);
  }
}
