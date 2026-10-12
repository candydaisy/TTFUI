// ================================
// RELATIONSHIP WEB DATA (pure - no DOM access)
// ================================
// Reads, checks, edits and writes Story/relationships.json, the file the
// game's relationship web (Scenes/Menus/relationship_web.gd) is built from.
//
//   characters: { id, name, playable?, color?, speaker?, route?, picture, about }
//   links:      { from, to, to_is, from_is }
//     to_is   = what `to` is to `from`
//     from_is = what `from` is to `to`

export const OTHER_COLOR = '#9e9e9e'; // non-playable characters in the game
const CHARACTER_KEYS = ['id', 'name', 'playable', 'color', 'speaker', 'route', 'picture', 'about'];
const LINK_KEYS = ['from', 'to', 'to_is', 'from_is'];

export function emptyWeb() {
  return { about: '', ignore_speakers: ['', '???'], characters: [], links: [] };
}

// Untrusted JSON -> a web with the expected shape. Unknown keys are kept.
export function normalizeWeb(data) {
  const web = emptyWeb();
  if (!data || typeof data !== 'object') return web;
  if (typeof data.about === 'string') web.about = data.about;
  if (Array.isArray(data.ignore_speakers)) web.ignore_speakers = data.ignore_speakers.map(String);
  Object.keys(data).forEach(k => {
    if (!['about', 'ignore_speakers', 'characters', 'links'].includes(k)) web[k] = data[k];
  });
  (Array.isArray(data.characters) ? data.characters : []).forEach(c => {
    if (c && typeof c.id === 'string' && c.id.trim()) web.characters.push({ ...c, id: c.id.trim() });
  });
  (Array.isArray(data.links) ? data.links : []).forEach(l => {
    if (l && typeof l.from === 'string' && typeof l.to === 'string') web.links.push({ ...l });
  });
  return web;
}

export function parseWeb(text) {
  return normalizeWeb(JSON.parse(text));
}

export function findCharacter(web, id) {
  return web.characters.find(c => c.id === id) || null;
}

export function characterColor(c) {
  return c && c.playable && /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : OTHER_COLOR;
}

// The name a character speaks under in the story files.
export function speakerOf(c) {
  return c.speaker || c.name || c.id;
}

// { otherId: what they are to `id` } - the same thing the game shows on click.
export function relationsOf(web, id) {
  const out = {};
  web.links.forEach(l => {
    if (l.from === id) out[l.to] = l.to_is || '';
    else if (l.to === id) out[l.from] = l.from_is || '';
  });
  return out;
}

export function linkBetween(web, a, b) {
  return web.links.find(l => (l.from === a && l.to === b) || (l.from === b && l.to === a)) || null;
}

// ================================
// EDITING (each returns a new web; the input isn't changed)
// ================================
function clone(web) {
  return JSON.parse(JSON.stringify(web));
}

export function uniqueId(web, base) {
  const clean = String(base || 'Character').replace(/[^A-Za-z0-9_]/g, '') || 'Character';
  let id = clean;
  for (let i = 2; findCharacter(web, id); i++) id = clean + i;
  return id;
}

export function addCharacter(web, fields = {}) {
  const next = clone(web);
  const id = uniqueId(next, fields.id || fields.name || 'NewCharacter');
  next.characters.push({ id, name: fields.name || id, picture: '', about: '', ...fields, id });
  return { web: next, id };
}

export function updateCharacter(web, id, fields) {
  const next = clone(web);
  const c = findCharacter(next, id);
  if (!c) return next;
  Object.assign(c, fields);
  // optional keys are removed when emptied, so the file stays tidy
  ['speaker', 'route', 'color'].forEach(k => { if (c[k] === '') delete c[k]; });
  if (c.playable === false) delete c.playable;
  return next;
}

// Renames an id everywhere it's used. Fails (returns null) if the id is taken.
export function renameCharacter(web, oldId, newId) {
  newId = String(newId || '').trim();
  if (!newId || (newId !== oldId && findCharacter(web, newId))) return null;
  const next = clone(web);
  const c = findCharacter(next, oldId);
  if (!c) return null;
  c.id = newId;
  next.links.forEach(l => {
    if (l.from === oldId) l.from = newId;
    if (l.to === oldId) l.to = newId;
  });
  return next;
}

export function removeCharacter(web, id) {
  const next = clone(web);
  next.characters = next.characters.filter(c => c.id !== id);
  next.links = next.links.filter(l => l.from !== id && l.to !== id);
  return next;
}

// Adds a link from `from` to `to`, unless they're already linked.
export function addLink(web, from, to, toIs = '', fromIs = '') {
  if (from === to || linkBetween(web, from, to)) return web;
  const next = clone(web);
  next.links.push({ from, to, to_is: toIs, from_is: fromIs });
  return next;
}

// Sets what `other` is to `self` (and/or what `self` is to `other`) on their link.
export function updateLinkLabels(web, self, other, { otherIs, selfIs } = {}) {
  const next = clone(web);
  const l = linkBetween(next, self, other);
  if (!l) return next;
  const selfIsFrom = l.from === self;
  if (otherIs !== undefined) l[selfIsFrom ? 'to_is' : 'from_is'] = otherIs;
  if (selfIs !== undefined) l[selfIsFrom ? 'from_is' : 'to_is'] = selfIs;
  return next;
}

export function removeLink(web, a, b) {
  const next = clone(web);
  next.links = next.links.filter(l => !((l.from === a && l.to === b) || (l.from === b && l.to === a)));
  return next;
}

// ================================
// CHECKS
// ================================
// `stories` is optional: [{ route: "Kay", speakers: ["Kay", "Mom", ...] }].
// Returns [{ type: 'error'|'warning', id?, text }].
export function checkWeb(web, stories = []) {
  const issues = [];
  const seen = new Set();
  web.characters.forEach(c => {
    if (seen.has(c.id)) issues.push({ type: 'error', id: c.id, text: `Two characters use the id "${c.id}".` });
    seen.add(c.id);
    if (c.playable && !/^#[0-9a-f]{6}$/i.test(c.color || '')) {
      issues.push({ type: 'warning', id: c.id, text: `${c.name || c.id} is playable but has no color (use #rrggbb).` });
    }
    if (c.route && !c.speaker) {
      issues.push({ type: 'warning', id: c.id, text: `${c.name || c.id} has a route but no speaker; route only matters with a speaker.` });
    }
  });

  const pairs = new Set();
  web.links.forEach(l => {
    if (!seen.has(l.from) || !seen.has(l.to)) {
      issues.push({ type: 'error', id: seen.has(l.from) ? l.from : l.to, text: `Link ${l.from} → ${l.to} uses an id that doesn't exist.` });
    }
    if (l.from === l.to) issues.push({ type: 'error', id: l.from, text: `${l.from} is linked to itself.` });
    const key = [l.from, l.to].sort().join('\u0000');
    if (pairs.has(key)) issues.push({ type: 'warning', id: l.from, text: `${l.from} and ${l.to} are linked twice.` });
    pairs.add(key);
    if (!l.to_is || !l.from_is) issues.push({ type: 'warning', id: l.from, text: `Link ${l.from} → ${l.to} is missing a label.` });
  });

  web.characters.forEach(c => {
    if (!web.links.some(l => l.from === c.id || l.to === c.id)) {
      issues.push({ type: 'warning', id: c.id, text: `${c.name || c.id} isn't linked to anyone.` });
    }
  });

  stories.forEach(story => {
    story.speakers.forEach(speaker => {
      if (web.ignore_speakers.includes(speaker)) return;
      const found = web.characters.some(c => speakerOf(c) === speaker && (!c.route || c.route === story.route));
      if (!found) issues.push({ type: 'error', text: `"${speaker}" speaks in ${story.route}'s story but isn't in the web. Add them, or add them to ignore_speakers.` });
    });
  });
  return issues;
}

// Speakers in a flow_graph.json (parsed object).
export function storySpeakers(flowGraph) {
  return [...new Set(Object.values(flowGraph || {}).map(n => (n && n.speaker) || ''))];
}

// ================================
// WRITING
// ================================
function inlineJSON(v) {
  if (Array.isArray(v)) return '[' + v.map(inlineJSON).join(', ') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ': ' + inlineJSON(x)).join(', ') + '}';
  }
  return JSON.stringify(v);
}

function ordered(obj, keys) {
  const out = {};
  keys.forEach(k => { if (obj[k] !== undefined) out[k] = obj[k]; });
  Object.keys(obj).forEach(k => { if (!(k in out)) out[k] = obj[k]; });
  return out;
}

// Same layout as Story/relationships.json in the game repo: one character or
// link per line, a blank line after the playable characters and between the
// links of each "from" character. Keeps git diffs small.
export function formatWeb(web) {
  const top = [];
  if (web.about) top.push(`\t"about": ${JSON.stringify(web.about)}`);
  top.push(`\t"ignore_speakers": ${inlineJSON(web.ignore_speakers)}`);
  Object.keys(web).forEach(k => {
    if (!['about', 'ignore_speakers', 'characters', 'links'].includes(k)) top.push(`\t${JSON.stringify(k)}: ${inlineJSON(web[k])}`);
  });

  const chars = web.characters.map((c, i) => {
    const gap = i > 0 && web.characters[i - 1].playable && !c.playable ? '\n' : '';
    return gap + '\t\t' + inlineJSON(ordered(c, CHARACTER_KEYS));
  });
  const links = web.links.map((l, i) => {
    const gap = i > 0 && web.links[i - 1].from !== l.from ? '\n' : '';
    return gap + '\t\t' + inlineJSON(ordered(l, LINK_KEYS));
  });

  const block = (name, rows) => `\t"${name}": [\n${rows.join(',\n')}\n\t]`;
  return '{\n' + [...top, block('characters', chars), block('links', links)].join(',\n\n') + '\n}\n';
}

// ================================
// LAYOUT (same force simulation idea as the game's web)
// ================================
// nodes: { id: { x, y, vx, vy, pinned? } }. Moves them one step; returns the
// total movement so callers can stop when it settles.
export function layoutStep(web, nodes, { repulsion = 30000, spring = 0.02, length = 210, gravity = 0.004, damping = 0.85 } = {}) {
  const ids = Object.keys(nodes);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = nodes[ids[i]], b = nodes[ids[j]];
      let dx = a.x - b.x, dy = a.y - b.y;
      const d2 = Math.max(dx * dx + dy * dy, 100);
      const d = Math.sqrt(d2);
      const f = repulsion / d2;
      dx /= d; dy /= d;
      a.vx += dx * f; a.vy += dy * f;
      b.vx -= dx * f; b.vy -= dy * f;
    }
  }
  web.links.forEach(l => {
    const a = nodes[l.from], b = nodes[l.to];
    if (!a || !b) return;
    let dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
    const f = (d - length) * spring;
    dx /= d; dy /= d;
    a.vx += dx * f; a.vy += dy * f;
    b.vx -= dx * f; b.vy -= dy * f;
  });
  let moved = 0;
  ids.forEach(id => {
    const n = nodes[id];
    n.vx = (n.vx - n.x * gravity) * damping;
    n.vy = (n.vy - n.y * gravity) * damping;
    if (n.pinned) return;
    n.x += n.vx; n.y += n.vy;
    moved += Math.abs(n.vx) + Math.abs(n.vy);
  });
  return moved;
}

// Starting positions: playable characters near the middle, others in a ring.
export function initialPositions(web, existing = {}) {
  const nodes = {};
  const count = Math.max(web.characters.length, 1);
  web.characters.forEach((c, i) => {
    if (existing[c.id]) { nodes[c.id] = { ...existing[c.id], vx: 0, vy: 0 }; return; }
    const angle = (Math.PI * 2 * i) / count;
    const r = c.playable ? 120 : 300;
    nodes[c.id] = { x: Math.cos(angle) * r, y: Math.sin(angle) * r, vx: 0, vy: 0 };
  });
  return nodes;
}
