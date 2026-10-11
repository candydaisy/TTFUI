// ================================
// GRAPH LOGIC (pure - no DOM access)
// ================================
// Everything in this module takes plain data and returns plain data, so it can
// be unit tested with `node --test`. A "graph" is `{ nodes, connections }`;
// the shared `state` object satisfies that shape directly.

export function createNode(id, x, y) {
  return {
    id, x, y,
    speaker: '', emotion: '', text: 'New line.',
    background: '', sfx: '', amb: '',
    showChars: '', hideChars: '', expression: '',
    secret: { condition: '', value: '', flag: '', next: '' },
    choices: []
  };
}

// "K, Friend ,," -> ["K", "Friend"]
export function splitList(str) {
  return String(str || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Where a port leads. A drawn connection wins; otherwise fall back to the
// reference stored on the node itself.
export function getTarget(graph, id, port) {
  const conn = graph.connections.find(c => c.from === id && c.fromPort === port);
  if (conn) return conn.to;
  const n = graph.nodes[id];
  if (!n) return '';
  if (port === 'out') return n.next || '';
  if (port === 'secret') return (n.secret && n.secret.next) || '';
  if (port.startsWith('choice-')) {
    const c = n.choices && n.choices[parseInt(port.slice(7))];
    return (c && c.next) || '';
  }
  return '';
}

// Rebuild the connection list from the next / secret.next / choice.next
// references stored on each node (used after import or loading the example).
export function buildConnections(nodes) {
  const connections = [];
  Object.values(nodes).forEach(n => {
    if (n.next && nodes[n.next]) connections.push({ from: n.id, fromPort: 'out', to: n.next });
    if (n.secret && n.secret.next && nodes[n.secret.next]) connections.push({ from: n.id, fromPort: 'secret', to: n.secret.next });
    n.choices && n.choices.forEach((c, i) => {
      if (c.next && nodes[c.next]) connections.push({ from: n.id, fromPort: `choice-${i}`, to: c.next });
    });
  });
  return connections;
}

// Point a copied node's references at the copies listed in idMap (oldId -> newId).
// References to nodes outside the copied set are cleared. Mutates and returns node.
export function remapRefs(node, idMap) {
  node.next = (node.next && idMap[node.next]) || '';
  if (node.secret) node.secret.next = (node.secret.next && idMap[node.secret.next]) || '';
  if (node.choices) node.choices.forEach(c => { c.next = (c.next && idMap[c.next]) || ''; });
  return node;
}

// Copy the connections whose both ends were copied, rewritten to the new IDs.
export function remapConnections(connections, idMap) {
  return connections
    .filter(c => idMap[c.from] && idMap[c.to])
    .map(c => ({ from: idMap[c.from], fromPort: c.fromPort, to: idMap[c.to] }));
}

// ================================
// CHARACTER PRESETS
// ================================
// A character is { name, color, emotions: [...] }. Presets are editor-only
// data: they are saved with the project (autosave / share links) but not
// written to the exported flow_graph JSON.
export const DEFAULT_EMOTIONS = ['angry', 'tired', 'sad', 'nervous'];
const CHARACTER_COLORS = ['#949cf2', '#23a55a', '#f0b232', '#00a8fc', '#e07be0', '#f2854b', '#4bdbd0', '#da373c'];

// Only plain hex colors are allowed into style attributes.
export function safeColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '';
}

export function findCharacter(characters, name) {
  const key = String(name || '').trim();
  return key ? (characters || []).find(c => c.name === key) || null : null;
}

// Emotions offered for a speaker: their preset list, or the defaults.
export function emotionsFor(characters, speaker) {
  const ch = findCharacter(characters, speaker);
  return ch && ch.emotions.length ? ch.emotions : DEFAULT_EMOTIONS;
}

export function nextCharacterColor(characters) {
  const used = new Set(characters.map(c => c.color));
  return CHARACTER_COLORS.find(c => !used.has(c)) || CHARACTER_COLORS[characters.length % CHARACTER_COLORS.length];
}

// Sanitize a character list from storage / share links into the expected shape.
export function normalizeCharacters(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach(c => {
    const name = c && typeof c.name === 'string' ? c.name.trim() : '';
    if (!name || out.some(o => o.name === name)) return;
    out.push({
      name,
      color: safeColor(c.color) || nextCharacterColor(out),
      emotions: Array.isArray(c.emotions) ? c.emotions.filter(e => typeof e === 'string' && e.trim()).map(e => e.trim()) : []
    });
  });
  return out;
}

// Merge characters found in the story (speakers, show/hide lists, expression
// keys) into `existing`, also adding any emotions they use. Returns a new list.
export function detectCharacters(nodes, existing = []) {
  const result = existing.map(c => ({ ...c, emotions: [...c.emotions] }));
  const ensure = name => {
    let ch = findCharacter(result, name);
    if (!ch) {
      ch = { name, color: nextCharacterColor(result), emotions: [] };
      result.push(ch);
    }
    return ch;
  };

  Object.values(nodes).forEach(n => {
    const speaker = String(n.speaker || '').trim();
    if (speaker) {
      const ch = ensure(speaker);
      if (n.emotion && !ch.emotions.includes(n.emotion)) ch.emotions.push(n.emotion);
    }
    [...splitList(n.showChars), ...splitList(n.hideChars)].forEach(ensure);
    splitList(n.expression).forEach(pair => {
      const name = pair.split(':')[0].trim();
      if (name) ensure(name);
    });
  });
  return result;
}

// Rename every reference to a character in the story. Mutates nodes and
// returns how many nodes changed.
export function renameCharacterRefs(nodes, oldName, newName) {
  const renameList = str => splitList(str).map(s => s === oldName ? newName : s).join(', ');
  let changed = 0;
  Object.values(nodes).forEach(n => {
    const before = JSON.stringify(n);
    if (String(n.speaker || '').trim() === oldName) n.speaker = newName;
    if (splitList(n.showChars).includes(oldName)) n.showChars = renameList(n.showChars);
    if (splitList(n.hideChars).includes(oldName)) n.hideChars = renameList(n.hideChars);
    if (n.expression) {
      const pairs = splitList(n.expression).map(pair => {
        const [char, ...rest] = pair.split(':');
        return char.trim() === oldName ? [newName, ...rest].join(':') : pair;
      });
      if (pairs.join(', ') !== splitList(n.expression).join(', ')) n.expression = pairs.join(', ');
    }
    if (JSON.stringify(n) !== before) changed++;
  });
  return changed;
}

// Number of lines each character speaks: { name: count }.
export function speakerLineCounts(nodes) {
  const counts = {};
  Object.values(nodes).forEach(n => {
    const s = String(n.speaker || '').trim();
    if (s) counts[s] = (counts[s] || 0) + 1;
  });
  return counts;
}

// ================================
// AUTO LAYOUT
// ================================
// Simple left-to-right topological layout. Returns { id: {x, y} }.
export function computeLayout(graph) {
  const { nodes, connections } = graph;
  const ids = Object.keys(nodes);
  const levels = {};
  const visited = new Set();

  function assignLevel(id, level) {
    if (visited.has(id)) return;
    visited.add(id);
    levels[id] = Math.max(levels[id] || 0, level);
    const n = nodes[id];
    if (n.next && nodes[n.next]) assignLevel(n.next, level + 1);
    if (n.secret && n.secret.next && nodes[n.secret.next]) assignLevel(n.secret.next, level + 1);
    n.choices && n.choices.forEach(c => { if (c.next && nodes[c.next]) assignLevel(c.next, level + 1); });
  }

  // find roots (no incoming connections)
  const hasIncoming = new Set(connections.map(c => c.to));
  const roots = ids.filter(id => !hasIncoming.has(id));
  if (!roots.length && ids.length) roots.push(ids[0]);
  roots.forEach(r => assignLevel(r, 0));
  ids.forEach(id => { if (levels[id] === undefined) levels[id] = 0; });

  const colNodes = {};
  ids.forEach(id => {
    const col = levels[id];
    if (!colNodes[col]) colNodes[col] = [];
    colNodes[col].push(id);
  });

  const colW = 280, rowH = 180;
  const positions = {};
  Object.entries(colNodes).forEach(([col, nodeIds]) => {
    nodeIds.forEach((id, row) => {
      positions[id] = { x: col * colW + 40, y: row * rowH + 40 };
    });
  });
  return positions;
}

// ================================
// EXPORT (game-ready flow_graph JSON)
// ================================
export function buildExportData(graph) {
  const exportData = {};

  Object.keys(graph.nodes).forEach(id => {
    const n = graph.nodes[id];
    const item = {};

    if (n.speaker !== undefined) item.speaker = n.speaker;
    if (n.emotion) item.emotion = n.emotion;
    item.text = n.text || '';

    const nextVal = getTarget(graph, id, 'out');
    if (nextVal && (!n.choices || !n.choices.length)) item.next = nextVal;

    if (n.background) item.background = n.background;
    if (n.showChars) item.show_characters = splitList(n.showChars);
    if (n.hideChars) item.hide_characters = splitList(n.hideChars);
    if (n.expression) {
      const expr = {};
      splitList(n.expression).forEach(p => {
        const [k, v] = p.split(':');
        if (k) expr[k.trim()] = (v || '').trim();
      });
      item.expression = expr;
    }
    if (n.sfx) item.sfx = n.sfx;
    if (n.amb) item.amb = n.amb;

    // secret
    if (n.secret && n.secret.condition) {
      const secretNext = getTarget(graph, id, 'secret');
      const secObj = { condition: n.secret.condition };
      if (n.secret.value !== undefined && n.secret.value !== '') {
        secObj.value = isNaN(Number(n.secret.value)) ? n.secret.value : Number(n.secret.value);
      }
      if (n.secret.flag) secObj.flag = n.secret.flag;
      if (secretNext) secObj.next = secretNext;
      item.secret = secObj;
    }

    // choices
    if (n.choices && n.choices.length) {
      item.choices = n.choices.map((c, ci) => {
        const choiceObj = {
          text: c.text,
          type: c.type || 'neutral',
          weight_change: Number(c.weight_change) || 0,
          next: getTarget(graph, id, `choice-${ci}`)
        };
        if (c.set_flag) choiceObj.set_flag = c.set_flag;
        return choiceObj;
      });
    }

    exportData[id] = item;
  });

  return exportData;
}

// ================================
// IMPORT (JSON / GDScript)
// ================================
// Extract just the dictionary body between the first { and last }, or null.
export function extractDictBody(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  return raw.slice(start, end + 1);
}

export function gdscriptDictToJSON(str) {
  // strip GDScript comments
  str = str.replace(/#[^\n]*/g, '');

  // GDScript uses unquoted keys in some cases - quote any bare word keys before a colon
  // e.g.  speaker: "K"  →  "speaker": "K"
  str = str.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');

  // also handle keys at start of string
  str = str.replace(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/gm, '$1"$2"$3');

  // remove trailing commas before } or ]
  str = str.replace(/,(\s*[}\]])/g, '$1');

  return str;
}

// Parse an exported flow_graph (JSON or GDScript dict) into editor nodes.
// Positions are all 0 - callers should run computeLayout. Throws on bad input.
export function parseFlowGraph(dictText) {
  const parsed = JSON.parse(gdscriptDictToJSON(dictText));
  const nodes = {};
  let maxNumericId = 0;

  Object.entries(parsed).forEach(([id, entry]) => {
    const numId = parseInt(id);
    if (!isNaN(numId) && numId >= maxNumericId) maxNumericId = numId + 1;

    nodes[id] = {
      id,
      x: 0, y: 0,
      speaker: entry.speaker || '',
      emotion: entry.emotion || '',
      text: entry.text || '',
      background: entry.background || '',
      sfx: entry.sfx || '',
      amb: entry.amb || '',
      showChars: (entry.show_characters || []).join(', '),
      hideChars: (entry.hide_characters || []).join(', '),
      expression: entry.expression
        ? Object.entries(entry.expression).map(([k, v]) => `${k}:${v}`).join(', ')
        : '',
      secret: {
        condition: entry.secret?.condition || '',
        value: entry.secret?.value !== undefined ? String(entry.secret.value) : '',
        flag: entry.secret?.flag || '',
        next: entry.secret?.next || ''
      },
      choices: (entry.choices || []).map(c => ({
        text: c.text || '',
        type: c.type || 'neutral',
        weight_change: c.weight_change || 0,
        next: c.next || '',
        set_flag: c.set_flag || ''
      })),
      next: entry.next || ''
    };
  });

  return { nodes, nextId: maxNumericId };
}

// ================================
// SHARE CODES (base64 of UTF-8 JSON)
// ================================
export function encodeShareCode(data) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
}

export function decodeShareCode(code) {
  return JSON.parse(decodeURIComponent(escape(atob(code))));
}

// ================================
// PLAYTEST
// ================================
export function evaluateSecretCondition(secret, weight, flags) {
  if (!secret || !secret.condition) return false;
  const cond = secret.condition;
  const val = Number(secret.value || 0);
  const flag = (secret.flag || '').trim();

  if (cond === 'weight_above') return weight > val;
  if (cond === 'weight_below') return weight < val;
  if (cond === 'flag_true') return flags.has(flag);
  if (cond === 'flag_false') return !flags.has(flag);
  return false;
}

// ================================
// SEARCH
// ================================
// `query` must already be lowercased.
export function nodeMatchesQuery(n, query) {
  if (String(n.id).toLowerCase().includes(query)) return true;
  if (n.speaker && n.speaker.toLowerCase().includes(query)) return true;
  if (n.text && n.text.toLowerCase().includes(query)) return true;
  if (n.emotion && n.emotion.toLowerCase().includes(query)) return true;
  if (n.background && n.background.toLowerCase().includes(query)) return true;
  if (n.sfx && n.sfx.toLowerCase().includes(query)) return true;
  if (n.amb && n.amb.toLowerCase().includes(query)) return true;
  if (n.secret && (
    (n.secret.condition && n.secret.condition.toLowerCase().includes(query)) ||
    (n.secret.flag && n.secret.flag.toLowerCase().includes(query)) ||
    (n.secret.next && n.secret.next.toLowerCase().includes(query))
  )) return true;
  return Boolean(n.choices && n.choices.some(c =>
    (c.text && c.text.toLowerCase().includes(query)) ||
    (c.set_flag && c.set_flag.toLowerCase().includes(query)) ||
    (c.next && c.next.toLowerCase().includes(query)) ||
    (c.type && c.type.toLowerCase().includes(query))
  ));
}

// ================================
// STORY DIAGNOSTICS & LINTER
// ================================
// Returns a list of { type: 'error'|'warning'|'info', nodeId, title, desc }.
export function analyzeGraph(graph) {
  const { nodes } = graph;
  const issues = [];
  const ids = Object.keys(nodes);
  if (!ids.length) return issues;

  // Set of all flags set in the game across choices
  const setFlags = new Set();
  ids.forEach(id => {
    (nodes[id].choices || []).forEach(c => {
      if (c.set_flag && c.set_flag.trim()) setFlags.add(c.set_flag.trim());
    });
  });

  // 1. Broken references (target node does not exist)
  ids.forEach(id => {
    const n = nodes[id];
    const nextTarget = getTarget(graph, id, 'out');
    if (nextTarget && !nodes[nextTarget]) {
      issues.push({
        type: 'error',
        nodeId: id,
        title: 'Broken Next Target',
        desc: `Node ${id} points to non-existent target "${nextTarget}".`
      });
    }

    const secretNext = getTarget(graph, id, 'secret');
    if (secretNext && !nodes[secretNext]) {
      issues.push({
        type: 'error',
        nodeId: id,
        title: 'Broken Secret Target',
        desc: `Secret route of Node ${id} points to non-existent target "${secretNext}".`
      });
    }

    (n.choices || []).forEach((c, i) => {
      const cTarget = getTarget(graph, id, `choice-${i}`);
      if (cTarget && !nodes[cTarget]) {
        issues.push({
          type: 'error',
          nodeId: id,
          title: `Broken Choice ${i + 1} Target`,
          desc: `Choice "${c.text || '#' + (i + 1)}" points to non-existent target "${cTarget}".`
        });
      }
    });
  });

  // 2. Unset flags
  ids.forEach(id => {
    const n = nodes[id];
    if (n.secret && (n.secret.condition === 'flag_true' || n.secret.condition === 'flag_false')) {
      const neededFlag = (n.secret.flag || '').trim();
      if (!neededFlag) {
        issues.push({
          type: 'error',
          nodeId: id,
          title: 'Missing Secret Flag Name',
          desc: `Condition "${n.secret.condition}" requires a flag name, but none is specified.`
        });
      } else if (!setFlags.has(neededFlag)) {
        issues.push({
          type: 'warning',
          nodeId: id,
          title: `Unset Flag Checked ("${neededFlag}")`,
          desc: `Secret route checks flag "${neededFlag}", but this flag is never set anywhere in choices.`
        });
      }
    }
  });

  // 3. Reachability / Orphan nodes (from start)
  const startId = nodes["1"] ? "1" : ids[0];
  const reachable = new Set([startId]);
  const queue = [startId];

  while (queue.length) {
    const curr = queue.shift();
    const n = nodes[curr];
    if (!n) continue;
    const ports = ['out', 'secret', ...(n.choices || []).map((_, i) => `choice-${i}`)];
    ports.forEach(port => {
      const nxt = getTarget(graph, curr, port);
      if (nxt && nodes[nxt] && !reachable.has(nxt)) {
        reachable.add(nxt);
        queue.push(nxt);
      }
    });
  }

  ids.forEach(id => {
    if (!reachable.has(id) && id !== startId) {
      issues.push({
        type: 'warning',
        nodeId: id,
        title: 'Orphan Node (Unreachable)',
        desc: `Node ${id} cannot be reached from root Node ${startId}.`
      });
    }
  });

  // 4. Dead ends (nodes with 0 outgoing paths when more than 1 node exists)
  if (ids.length > 1) {
    ids.forEach(id => {
      const n = nodes[id];
      const hasDirectNext = Boolean(getTarget(graph, id, 'out'));
      const hasChoices = Boolean(n.choices && n.choices.length);
      const hasSecret = Boolean(getTarget(graph, id, 'secret'));

      if (!hasDirectNext && !hasChoices && !hasSecret) {
        issues.push({
          type: 'info',
          nodeId: id,
          title: 'Story End / Dead End',
          desc: `Node ${id} has no choices or outgoing connections.`
        });
      }
    });
  }

  // 5. Speakers / emotions that don't match the character presets (typo check).
  // Only runs once at least one character has been defined.
  const characters = graph.characters || [];
  if (characters.length) {
    ids.forEach(id => {
      const n = nodes[id];
      const speaker = String(n.speaker || '').trim();
      if (!speaker) return;
      const ch = findCharacter(characters, speaker);
      if (!ch) {
        issues.push({
          type: 'warning',
          nodeId: id,
          title: `Unknown Speaker ("${speaker}")`,
          desc: `Speaker "${speaker}" is not in Characters. Check for a typo, or add them as a character.`
        });
      } else if (n.emotion && ch.emotions.length && !ch.emotions.includes(n.emotion)) {
        issues.push({
          type: 'info',
          nodeId: id,
          title: `Unlisted Emotion ("${n.emotion}")`,
          desc: `${ch.name} has no "${n.emotion}" emotion in Characters.`
        });
      }
    });
  }

  return issues;
}

// ================================
// EXAMPLE STORY
// ================================
export function exampleGraph() {
  const blankSecret = () => ({ condition: "", value: "", flag: "", next: "" });
  const nodes = {
    "1": { id:"1", x:40, y:100, speaker:"", emotion:"", text:"Alarm goes off..", background:"", sfx:"alarm", amb:"bedroom", showChars:"", hideChars:"", expression:"", secret:blankSecret(), choices:[], next:"2" },
    "2": { id:"2", x:310, y:100, speaker:"K", emotion:"tired", text:"mhm...", background:"bedroom", sfx:"", amb:"", showChars:"K", hideChars:"Friend", expression:"K:tired", secret:blankSecret(), choices:[], next:"3" },
    "3": { id:"3", x:580, y:100, speaker:"K", emotion:"angry", text:"i hate school mornings.", background:"bedroom", sfx:"", amb:"", showChars:"K", hideChars:"Friend", expression:"K:angry", secret:blankSecret(), choices:[
      {text:"It's fine.", type:"helpful", weight_change:10, next:"4", set_flag:""},
      {text:"Just tired.", type:"neutral", weight_change:5, next:"5", set_flag:""},
      {text:"No. I'm exhausted.", type:"honest", weight_change:-15, next:"6", set_flag:"was_honest"}
    ]},
    "4": { id:"4", x:870, y:0, speaker:"Friend", emotion:"", text:"You always say that.", background:"", sfx:"", amb:"", showChars:"", hideChars:"", expression:"", secret:blankSecret(), choices:[], next:"7" },
    "5": { id:"5", x:870, y:100, speaker:"Friend", emotion:"", text:"Then rest more.", background:"", sfx:"", amb:"", showChars:"", hideChars:"", expression:"", secret:blankSecret(), choices:[], next:"7" },
    "6": { id:"6", x:870, y:200, speaker:"Friend", emotion:"", text:"You should talk to someone.", background:"", sfx:"", amb:"", showChars:"", hideChars:"", expression:"", secret:blankSecret(), choices:[], next:"7" },
    "7": { id:"7", x:1140, y:100, speaker:"K", emotion:"", text:"something feels off.", background:"", sfx:"", amb:"", showChars:"", hideChars:"", expression:"", secret:{condition:"weight_below",value:"1",flag:"",next:"secret_1"}, choices:[], next:"8" },
    "secret_1": { id:"secret_1", x:1140, y:260, speaker:"K", emotion:"sad", text:"...this isn't right.", background:"", sfx:"", amb:"", showChars:"", hideChars:"", expression:"", secret:blankSecret(), choices:[] },
    "8": { id:"8", x:1400, y:100, speaker:"K", emotion:"", text:"another normal day...", background:"", sfx:"", amb:"", showChars:"", hideChars:"", expression:"", secret:blankSecret(), choices:[] }
  };
  const characters = [
    { name: "K", color: "#949cf2", emotions: ["tired", "angry", "sad", "nervous"] },
    { name: "Friend", color: "#23a55a", emotions: [] }
  ];
  return { nodes, nextId: 9, characters };
}
