// ================================
// CANVAS: view transform, interaction, node elements, connections, selection
// ================================
import { state, lastSelectedId } from './state.js';
import { escapeHTML } from './utils.js';
import { splitList, findCharacter, meterNames, meterKey, changeTone, noticesIn } from './graph.js';
import { getSnapshot, pushHistory, commitSnapshot } from './history.js';
import { renderSidebar } from './sidebar.js';
import { markDirty } from './io.js';
import { openPlaytest } from './playtest.js';
import { scheduleMinimap } from './minimap.js';
import {
  addNode, pasteNode, deleteNode, deleteSelectedNodes,
  copyNode, copySelectedNodes, duplicateNode, duplicateSelectedNodes
} from './nodes.js';

// Transient interaction state
let dragging = null; // {primaryId, startX, startY, startPositions, moved, shiftKey}
let dragStartSnapshot = null;
let panning = false;
let panStart = {};
let connecting = null; // {id, port, sx, sy}
let marqueeSelecting = false;
let marqueeStart = null;
let initialSelectedNodes = new Set();
let ctxTarget = null;
let ctxPos = { x: 0, y: 0 };
let pendingMove = null; // latest mousemove, applied once per animation frame

// Measured node geometry: nodeId -> { w, h, ports: { port: {x, y} } }, with port
// centers relative to the node's top-left corner. Measured once per node render
// instead of on every redraw (layout reads are what made dragging slow).
const nodeGeometry = new Map();

// SVG shapes currently drawn: key -> { el, sig }. Redraws update only shapes
// whose attributes changed instead of re-parsing every connection.
const SVG_NS = 'http://www.w3.org/2000/svg';
const drawnShapes = new Map();

// ================================
// GRID
// ================================
export function drawGrid() {
  const svg = document.getElementById('grid-svg');
  const W = window.innerWidth, H = window.innerHeight;
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  const size = 28;
  svg.innerHTML = `<defs><pattern id="grid" width="${size}" height="${size}" patternUnits="userSpaceOnUse">
    <path d="M ${size} 0 L 0 0 0 ${size}" fill="none" stroke="#1e1e2a" stroke-width="1"/>
  </pattern></defs>
  <rect width="100%" height="100%" fill="url(#grid)"/>`;
}

// ================================
// TRANSFORM
// ================================
export function applyTransform() {
  const c = document.getElementById('canvas');
  c.style.transform = `translate(${state.pan.x}px,${state.pan.y}px) scale(${state.zoom})`;
  document.getElementById('zoom-label').textContent = Math.round(state.zoom * 100) + '%';
  scheduleMinimap();
}

// Zoom keeping the canvas point at (mx, my) (relative to canvas-wrap) fixed.
function zoomAt(newZoom, mx, my) {
  const oldZoom = state.zoom;
  state.zoom = Math.max(0.2, Math.min(2.5, newZoom));
  state.pan.x = mx - (mx - state.pan.x) * (state.zoom / oldZoom);
  state.pan.y = my - (my - state.pan.y) * (state.zoom / oldZoom);
  applyTransform();
}

function zoomToward(newZoom) {
  const rect = document.getElementById('canvas-wrap').getBoundingClientRect();
  zoomAt(newZoom, rect.width / 2, rect.height / 2);
}
export function zoomIn()  { zoomToward(state.zoom + 0.1); }
export function zoomOut() { zoomToward(state.zoom - 0.1); }
// Fits the whole story in view (never zooming past 100%).
export function resetZoom() {
  const nodes = Object.values(state.nodes);
  if (!nodes.length) { state.zoom = 1; state.pan = { x: 60, y: 60 }; applyTransform(); return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const el = document.getElementById('node-' + n.id);
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + (el ? el.offsetWidth : 250));
    maxY = Math.max(maxY, n.y + (el ? el.offsetHeight : 120));
  }
  const wrap = document.getElementById('canvas-wrap');
  const pad = 60;
  state.zoom = Math.max(0.2, Math.min(1, (wrap.clientWidth - pad * 2) / (maxX - minX), (wrap.clientHeight - pad * 2) / (maxY - minY)));
  state.pan.x = (wrap.clientWidth - (maxX - minX) * state.zoom) / 2 - minX * state.zoom;
  state.pan.y = (wrap.clientHeight - (maxY - minY) * state.zoom) / 2 - minY * state.zoom;
  applyTransform();
}

// Convert a client (screen) position to canvas coordinates.
export function screenToCanvas(clientX, clientY) {
  const rect = document.getElementById('canvas-wrap').getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.pan.x) / state.zoom,
    y: (clientY - rect.top - state.pan.y) / state.zoom
  };
}

// Center the view on a canvas point.
export function panTo(x, y) {
  const wrap = document.getElementById('canvas-wrap');
  state.pan.x = wrap.clientWidth / 2 - x * state.zoom;
  state.pan.y = wrap.clientHeight / 2 - y * state.zoom;
  applyTransform();
}

export function centerOnNode(id) {
  const n = state.nodes[id];
  if (!n) return;
  const rect = document.getElementById('canvas-wrap').getBoundingClientRect();
  const nodeW = 250;
  const nodeH = 120;
  state.pan.x = rect.width / 2 - (n.x + nodeW / 2) * state.zoom;
  state.pan.y = rect.height / 2 - (n.y + nodeH / 2) * state.zoom;
  applyTransform();
  selectNode(id);
  highlightNode(id);
}

function highlightNode(id) {
  clearHighlight();
  const el = document.getElementById('node-' + id);
  if (el) el.classList.add('search-focus');
}

export function clearHighlight() {
  document.querySelectorAll('.node').forEach(el => el.classList.remove('search-focus'));
}

// ================================
// CANVAS EVENTS
// ================================
function updateTempLine(sx, sy, x, y) {
  const svg = document.getElementById('temp-line');
  const line = document.getElementById('temp-line-el');
  svg.style.width = window.innerWidth + 'px';
  svg.style.height = window.innerHeight + 'px';
  svg.style.left = '0'; svg.style.top = '0';
  line.setAttribute('x1', sx);
  line.setAttribute('y1', sy);
  line.setAttribute('x2', x);
  line.setAttribute('y2', y);
}

function hideTempLine() {
  document.getElementById('temp-line').style.width = '0';
}

function flushPendingMove() {
  if (!pendingMove) return;
  const e = pendingMove;
  pendingMove = null;
  onMouseMove(e);
}

function onMouseMove(e) {
  if (panning) {
    state.pan.x = e.clientX - panStart.x;
    state.pan.y = e.clientY - panStart.y;
    applyTransform();
  }
  if (dragging) {
    const dx = (e.clientX - dragging.startX) / state.zoom;
    const dy = (e.clientY - dragging.startY) / state.zoom;
    if (Math.hypot(e.clientX - dragging.startX, e.clientY - dragging.startY) > 3) {
      dragging.moved = true;
    }
    Object.keys(dragging.startPositions).forEach(nid => {
      const n = state.nodes[nid];
      if (n) {
        n.x = Math.max(0, Math.round(dragging.startPositions[nid].x + dx));
        n.y = Math.max(0, Math.round(dragging.startPositions[nid].y + dy));
        const el = document.getElementById('node-' + nid);
        if (el) {
          el.style.left = n.x + 'px';
          el.style.top = n.y + 'px';
        }
      }
    });
    renderConnections();
    markDirty();
  }
  if (marqueeSelecting && marqueeStart) {
    const wrapRect = document.getElementById('canvas-wrap').getBoundingClientRect();
    const minX = Math.min(e.clientX, marqueeStart.clientX);
    const maxX = Math.max(e.clientX, marqueeStart.clientX);
    const minY = Math.min(e.clientY, marqueeStart.clientY);
    const maxY = Math.max(e.clientY, marqueeStart.clientY);

    const mBox = document.getElementById('selection-box');
    if (mBox) {
      mBox.style.left = (minX - wrapRect.left) + 'px';
      mBox.style.top = (minY - wrapRect.top) + 'px';
      mBox.style.width = (maxX - minX) + 'px';
      mBox.style.height = (maxY - minY) + 'px';
    }

    // Calculate canvas bounds
    const topLeft = screenToCanvas(minX, minY);
    const bottomRight = screenToCanvas(maxX, maxY);

    const nextSelection = new Set(e.shiftKey ? initialSelectedNodes : []);
    Object.keys(state.nodes).forEach(id => {
      const n = state.nodes[id];
      const el = document.getElementById('node-' + id);
      const nw = el ? el.offsetWidth : 260;
      const nh = el ? el.offsetHeight : 140;
      const intersects = !(n.x > bottomRight.x || n.x + nw < topLeft.x || n.y > bottomRight.y || n.y + nh < topLeft.y);
      if (intersects) {
        nextSelection.add(id);
      }
    });

    state.selectedNodes = nextSelection;
    state.selectedNode = lastSelectedId();
    updateSelectionVisuals();
  }
  if (connecting) {
    updateTempLine(connecting.sx, connecting.sy, e.clientX, e.clientY);
  }
}

export function setupCanvasEvents() {
  const wrap = document.getElementById('canvas-wrap');

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    // keep the canvas point under the cursor fixed
    zoomAt(state.zoom + delta, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  // the empty-state buttons shouldn't start a marquee or a touch pan
  const hint = document.getElementById('empty-hint');
  ['mousedown', 'touchstart'].forEach(t => hint.addEventListener(t, e => e.stopPropagation()));

  wrap.addEventListener('mousedown', e => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      panning = true;
      panStart = { x: e.clientX - state.pan.x, y: e.clientY - state.pan.y };
      wrap.classList.add('panning');
      e.preventDefault();
    } else if (e.button === 0 && !e.target.closest('.node') && !e.target.closest('.port')) {
      if (!e.shiftKey) {
        selectNode(null);
      }
      marqueeSelecting = true;
      marqueeStart = { clientX: e.clientX, clientY: e.clientY };
      initialSelectedNodes = new Set(state.selectedNodes);
      const mBox = document.getElementById('selection-box');
      if (mBox) {
        const wrapRect = wrap.getBoundingClientRect();
        mBox.style.left = (e.clientX - wrapRect.left) + 'px';
        mBox.style.top = (e.clientY - wrapRect.top) + 'px';
        mBox.style.width = '0px';
        mBox.style.height = '0px';
        mBox.style.display = 'block';
      }
    }
    hideCtxMenu();
  });

  // Mice can fire several moves per frame; only the latest one per frame is applied.
  window.addEventListener('mousemove', e => {
    if (!pendingMove) requestAnimationFrame(flushPendingMove);
    pendingMove = e;
  });

  window.addEventListener('mouseup', e => {
    flushPendingMove(); // apply the final position before finishing the gesture
    if (panning) {
      panning = false;
      wrap.classList.remove('panning');
    }
    if (dragging) {
      if (dragging.moved && dragStartSnapshot) {
        commitSnapshot(dragStartSnapshot);
      } else if (!dragging.moved && !dragging.shiftKey) {
        selectNode(dragging.primaryId, false);
      }
      dragging = null;
      dragStartSnapshot = null;
    }
    if (marqueeSelecting) {
      marqueeSelecting = false;
      marqueeStart = null;
      const mBox = document.getElementById('selection-box');
      if (mBox) mBox.style.display = 'none';
      renderSidebar();
    }
    if (connecting) {
      const svg = document.getElementById('temp-line');
      svg.style.width = '0'; svg.style.height = '0';
      dropWire(e.target, e.clientX, e.clientY);
      connecting = null;
    }
  });

  wrap.addEventListener('contextmenu', e => {
    e.preventDefault();
    ctxTarget = null;
    ctxPos = { x: e.clientX, y: e.clientY };
    showCtxMenu(e.clientX, e.clientY, false);
  });

  // ---- TOUCH EVENTS ----
  let lastPinchDist = null;
  let touchPanStart = null;
  let touchDragNode = null;
  let touchDragOffset = { ox: 0, oy: 0 };
  let touchTapTimer = null;
  let touchTapPos = null;

  function getTouchDist(t1, t2) {
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  }
  function getTouchMid(t1, t2) {
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
  }

  wrap.addEventListener('touchstart', e => {
    e.preventDefault();
    hideCtxMenu();

    const t = e.touches;

    if (t.length === 1) {
      const touch = t[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);

      // check if touching a port
      const portEl = target && target.closest('.port');
      if (portEl && portEl.dataset.port !== 'in') {
        const rect = portEl.getBoundingClientRect();
        connecting = {
          id: portEl.dataset.node,
          port: portEl.dataset.port,
          sx: rect.left + rect.width / 2,
          sy: rect.top + rect.height / 2
        };
        return;
      }

      // check if touching a node header → drag node
      const headerEl = target && target.closest('.node-header');
      const nodeEl = target && target.closest('.node');
      if (nodeEl) {
        const nodeId = nodeEl.id.replace('node-', '');
        selectNode(nodeId);

        if (headerEl) {
          const rect = nodeEl.getBoundingClientRect();
          touchDragNode = nodeId;
          touchDragOffset = {
            ox: (touch.clientX - rect.left) / state.zoom,
            oy: (touch.clientY - rect.top) / state.zoom
          };
          return;
        }
      }

      // single touch on empty canvas - prepare for tap (add node) or pan
      touchPanStart = { x: touch.clientX - state.pan.x, y: touch.clientY - state.pan.y };

      // long press to add node
      touchTapPos = { x: touch.clientX, y: touch.clientY };
      touchTapTimer = setTimeout(() => {
        if (touchTapPos) {
          ctxTarget = null;
          ctxPos = touchTapPos;
          showCtxMenu(touchTapPos.x, touchTapPos.y, false);
          touchTapPos = null;
        }
      }, 600);

    } else if (t.length === 2) {
      // two fingers - pan + pinch zoom
      clearTimeout(touchTapTimer);
      touchTapPos = null;
      touchDragNode = null;
      connecting = null;
      lastPinchDist = getTouchDist(t[0], t[1]);
      const mid = getTouchMid(t[0], t[1]);
      touchPanStart = { x: mid.x - state.pan.x, y: mid.y - state.pan.y };
    }
  }, { passive: false });

  wrap.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = e.touches;

    clearTimeout(touchTapTimer);
    touchTapPos = null;

    if (t.length === 1) {
      const touch = t[0];

      // move connecting line
      if (connecting) {
        updateTempLine(connecting.sx, connecting.sy, touch.clientX, touch.clientY);
        return;
      }

      // drag node
      if (touchDragNode) {
        const p = screenToCanvas(touch.clientX, touch.clientY);
        state.nodes[touchDragNode].x = Math.max(0, p.x - touchDragOffset.ox);
        state.nodes[touchDragNode].y = Math.max(0, p.y - touchDragOffset.oy);
        updateNodeEl(touchDragNode);
        renderConnections();
        markDirty();
        return;
      }

      // single finger pan (only on empty canvas)
      if (touchPanStart) {
        state.pan.x = touch.clientX - touchPanStart.x;
        state.pan.y = touch.clientY - touchPanStart.y;
        applyTransform();
      }

    } else if (t.length === 2) {
      // two finger pan + pinch zoom
      const mid = getTouchMid(t[0], t[1]);
      state.pan.x = mid.x - touchPanStart.x;
      state.pan.y = mid.y - touchPanStart.y;

      const dist = getTouchDist(t[0], t[1]);
      if (lastPinchDist) {
        // zoom toward pinch midpoint
        const rect = wrap.getBoundingClientRect();
        zoomAt(state.zoom * (dist / lastPinchDist), mid.x - rect.left, mid.y - rect.top);
      }
      lastPinchDist = dist;
      applyTransform();
    }
  }, { passive: false });

  wrap.addEventListener('touchend', e => {
    clearTimeout(touchTapTimer);

    const t = e.changedTouches;

    // finish connecting on touch
    if (connecting && t.length > 0) {
      const touch = t[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const portEl = target && target.closest('.port');
      if (portEl && portEl.dataset.port === 'in' && portEl.dataset.node !== connecting.id) {
        connectPorts(connecting.id, connecting.port, portEl.dataset.node);
      } else {
        dropWire(target, touch.clientX, touch.clientY);
      }
      hideTempLine();
      connecting = null;
    }

    touchDragNode = null;
    touchPanStart = null;
    lastPinchDist = null;

    if (e.touches.length === 0) {
      touchTapPos = null;
    }
  }, { passive: false });
}

// Connect an output port to a target node (replacing that port's old link).
// A wire dropped on empty canvas makes the next node there, already connected.
function dropWire(target, clientX, clientY) {
  if (!target || !target.closest('#canvas-wrap') || target.closest('.node, #minimap, #search-bar')) return;
  const { id, port } = connecting;
  const newId = addNode(clientX, clientY);
  connectPorts(id, port, newId, false); // addNode already saved the undo step
}

function connectPorts(fromId, port, toId, record = true) {
  if (record) pushHistory();
  state.connections = state.connections.filter(c => !(c.from === fromId && c.fromPort === port));
  state.connections.push({ from: fromId, fromPort: port, to: toId });

  // update the correct next reference
  const n = state.nodes[fromId];
  if (port === 'out') {
    n.next = toId;
  } else if (port === 'secret') {
    n.secret.next = toId;
  } else if (port.startsWith('choice-')) {
    const idx = parseInt(port.split('-')[1]);
    if (n.choices[idx]) n.choices[idx].next = toId;
  }

  updateNodeEl(fromId);
  renderConnections();
  renderSidebar();
  markDirty();
}

// ================================
// NODE ELEMENTS
// ================================
function attachNodeEvents(el, id) {
  setupPorts(el, id);

  const startDrag = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    if (e.shiftKey) {
      selectNode(id, true);
      return;
    }

    if (!state.selectedNodes.has(id)) {
      selectNode(id, false);
    }

    const startPositions = {};
    state.selectedNodes.forEach(nid => {
      if (state.nodes[nid]) {
        startPositions[nid] = { x: state.nodes[nid].x, y: state.nodes[nid].y };
      }
    });

    dragStartSnapshot = getSnapshot();
    dragging = {
      primaryId: id,
      startX: e.clientX,
      startY: e.clientY,
      startPositions,
      moved: false,
      shiftKey: e.shiftKey
    };
  };

  const header = el.querySelector('.node-header');
  if (header) header.addEventListener('mousedown', startDrag);

  el.addEventListener('mousedown', e => {
    if (e.button === 0 && !e.target.closest('.port') && !e.target.closest('.node-header')) {
      if (e.shiftKey) {
        e.stopPropagation();
        selectNode(id, true);
      } else if (!state.selectedNodes.has(id)) {
        e.stopPropagation();
        selectNode(id, false);
      }
    }
  });

  el.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    if (!state.selectedNodes.has(id)) {
      selectNode(id, false);
    }
    ctxTarget = id;
    ctxPos = { x: e.clientX, y: e.clientY };
    showCtxMenu(e.clientX, e.clientY, true);
  });

  el.classList.toggle('selected', state.selectedNodes.has(id));
}

export function createNodeEl(id) {
  const el = document.createElement('div');
  el.className = 'node';
  el.id = 'node-' + id;
  document.getElementById('nodes-layer').appendChild(el);
  updateNodeEl(id);
  return el;
}

// Throw away all node elements and recreate them from state.nodes.
export function rebuildNodeElements() {
  nodeGeometry.clear();
  document.getElementById('nodes-layer').innerHTML = '';
  Object.keys(state.nodes).forEach(id => createNodeEl(id));
}

function buildNodeHTML(id) {
  const n = state.nodes[id];
  const emotionBadge = n.emotion ? `<span class="node-emotion-badge emotion-${escapeHTML(n.emotion)}">${escapeHTML(n.emotion)}</span>` : '';

  // ---- detail rows ----
  const detailRow = (label, color, value) => `<div class="node-detail-row">
      <span class="node-detail-label" style="color:${color};">${label}</span>
      <span class="node-detail-value" style="color:${color};">${escapeHTML(value)}</span>
    </div>`;

  let detailRows = '';
  if (n.background) detailRows += detailRow('bg', 'var(--success)', n.background);
  if (n.sfx) detailRows += detailRow('sfx', 'var(--warning)', n.sfx);
  if (n.amb) detailRows += detailRow('amb', 'var(--info)', '~ ' + n.amb);
  if (n.voice) detailRows += detailRow('voice', 'var(--accent-light)', n.voice);
  if (n.realText) detailRows += detailRow('real', 'var(--warning)', n.realText);
  if (n.cut) detailRows += detailRow('cut', 'var(--warning)', (n.cutAfter || '') + ' — ' + n.cut);
  if (n.showChars) detailRows += detailRow('show', 'var(--success)', splitList(n.showChars).join(', '));
  if (n.hideChars) detailRows += detailRow('hide', 'var(--danger)', splitList(n.hideChars).join(', '));
  if (n.expression) {
    // expression is "Char:anim, Char2:anim2" - show each pair
    splitList(n.expression).forEach(pair => {
      const [char, anim] = pair.split(':').map(s => s.trim());
      detailRows += detailRow('anim', 'var(--accent-light)', char + (anim ? ' → ' + anim : ''));
    });
  }

  // ---- secret badge ----
  const secretBadge = (n.secret && n.secret.condition)
    ? `<span class="tag tag-secret">secret: ${escapeHTML(n.secret.condition)}${n.secret.flag ? ' ' + escapeHTML(n.secret.flag) : ''}${n.secret.value ? ' ' + escapeHTML(n.secret.value) : ''}</span>`
    : '';

  // ---- choices badge ----
  const choicesBadge = (n.choices && n.choices.length)
    ? `<span class="tag tag-choices">${n.choices.length} ${n.minigame ? 'result' : 'choice'}${n.choices.length > 1 ? 's' : ''}</span>`
    : '';

  const portY = 20;
  const hasChoices = n.choices && n.choices.length > 0;
  const nodeAttr = escapeHTML(id);
  const character = findCharacter(state.characters, n.speaker);
  const speakerColor = character ? character.color : '';

  let choicePortsHTML = '';
  let choiceRowsHTML = '';
  if (hasChoices) {
    n.choices.forEach((c, i) => {
      const py = 52 + i * 22;
      choiceRowsHTML += `<div class="node-choice-row" style="display:flex;align-items:center;gap:4px;margin-top:4px;padding-right:14px;">
        <span style="font-size:10px;color:var(--accent);font-weight:700;min-width:12px;">${i+1}</span>
        <span style="font-size:10px;color:var(--text-dim);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${n.minigame ? escapeHTML(c.result || '?') + ': ' : ''}${escapeHTML(c.text || '...')}</span>
        ${meterNames(state.mode).map(m => {
          const v = Number(c[meterKey(m)]) || 0;
          return v ? `<span class="node-choice-delta ${changeTone(state.mode, m, v)}" title="${escapeHTML(m)}">${escapeHTML(m[0])}${v > 0 ? '+' : ''}${v}</span>` : '';
        }).join('')}
        ${c.set_flag ? `<span style="font-size:10px;color:var(--warning);font-family:var(--font-mono);">flag: ${escapeHTML(c.set_flag)}</span>` : ''}
        ${c.requires ? `<span style="font-size:10px;color:var(--info);font-family:var(--font-mono);">needs: ${escapeHTML(c.requires)}</span>` : ''}
      </div>`;
      choicePortsHTML += `<div class="port out choice-port" data-node="${nodeAttr}" data-port="choice-${i}" style="top:${py}px" title="Choice ${i+1}: ${escapeHTML(c.text)}"></div>`;
    });
  }

  const timedBadge = n.timed ? `<span class="tag tag-timed">timed</span>` : '';
  const editBadge = n.realText ? `<span class="tag tag-timed">self-edit</span>` : '';
  const notices = noticesIn(n.text);
  const extraBadges = [
    n.call && `call: ${n.call}`,
    n.minigame && `minigame: ${n.minigame.split('/').pop()}`,
    n.tr && n.tr.text && 'translated',
    n.quiet && 'quiet',
    n.cut && 'cut-off',
    notices.length && `notice: ${notices.map(d => d.flag).join(', ')}`,
  ].filter(Boolean).map(t => `<span class="tag tag-timed">${escapeHTML(t)}</span>`).join('');
  const tagsHTML = (secretBadge || choicesBadge || timedBadge || editBadge || extraBadges)
    ? `<div class="node-tags" style="margin-top:5px;">${secretBadge}${choicesBadge}${timedBadge}${editBadge}${extraBadges}</div>`
    : '';

  return `
    <div class="node-header">
      <span class="node-id">${escapeHTML(n.id)}</span>
      <span class="node-speaker"${speakerColor ? ` style="color:${speakerColor};"` : ''}>${escapeHTML(n.speaker || '<narrator>')}</span>
      ${emotionBadge}
    </div>
    <div class="node-body">
      <div class="node-text">${escapeHTML(n.text)}</div>
      ${detailRows ? `<div style="margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,0.05);">${detailRows}</div>` : ''}
      ${choiceRowsHTML}
      ${tagsHTML}
    </div>
    <div class="port in" data-node="${nodeAttr}" data-port="in" style="top:${portY}px" title="Input"></div>
    ${!hasChoices ? `<div class="port out" data-node="${nodeAttr}" data-port="out" style="top:${portY}px" title="Next"></div>` : ''}
    ${choicePortsHTML}
    ${n.secret && n.secret.condition ? `<div class="port secret-out" data-node="${nodeAttr}" data-port="secret" style="top:${portY+22}px" title="Secret route"></div>` : ''}
  `;
}

export function updateNodeEl(id) {
  const el = document.getElementById('node-' + id);
  if (!el) return;
  const n = state.nodes[id];
  el.style.left = n.x + 'px';
  el.style.top = n.y + 'px';
  el.innerHTML = buildNodeHTML(id);
  attachNodeEvents(el, id);
  nodeGeometry.delete(id); // size and ports may have changed
}

function setupPorts(el, id) {
  el.querySelectorAll('.port').forEach(port => {
    port.addEventListener('mousedown', e => {
      e.stopPropagation();
      if (port.dataset.port === 'in') {
        // clicking an input port disconnects everything feeding into it
        if (state.connections.some(c => c.to === id)) {
          pushHistory();
          state.connections = state.connections.filter(c => c.to !== id);
          renderConnections();
          renderSidebar();
          markDirty();
        }
        return;
      }
      const rect = port.getBoundingClientRect();
      connecting = {
        id, port: port.dataset.port,
        sx: rect.left + rect.width/2,
        sy: rect.top + rect.height/2
      };
    });

    port.addEventListener('mouseup', e => {
      e.stopPropagation();
      if (connecting && port.dataset.port === 'in' && connecting.id !== id) {
        connectPorts(connecting.id, connecting.port, id);
      }
      connecting = null;
      hideTempLine();
    });
  });
}

// ================================
// CONNECTIONS
// ================================
function getNodeGeometry(nodeId) {
  let geo = nodeGeometry.get(nodeId);
  if (geo) return geo;
  const el = document.getElementById('node-' + nodeId);
  if (!el) return null;
  geo = { w: el.offsetWidth, h: el.offsetHeight, ports: {} };
  el.querySelectorAll('.port').forEach(port => {
    // offsetLeft/Top are relative to the node's padding box, so add its border
    geo.ports[port.dataset.port] = {
      x: el.clientLeft + port.offsetLeft + port.offsetWidth / 2,
      y: el.clientTop + port.offsetTop + port.offsetHeight / 2
    };
  });
  nodeGeometry.set(nodeId, geo);
  return geo;
}

// Node size in canvas pixels, or null if it has no element.
export function getNodeSize(nodeId) {
  const geo = getNodeGeometry(nodeId);
  return geo ? { w: geo.w, h: geo.h } : null;
}

// Port center in canvas coordinates.
function getPortCenter(nodeId, portType) {
  const n = state.nodes[nodeId];
  const geo = n && getNodeGeometry(nodeId);
  const o = geo && geo.ports[portType];
  return o ? { x: n.x + o.x, y: n.y + o.y } : null;
}

export function renderConnections() {
  const svg = document.getElementById('connections-svg');
  const nodes = state.nodes;

  // dynamically size SVG to cover all nodes with padding
  let maxX = 2000, maxY = 2000;
  Object.values(nodes).forEach(n => {
    maxX = Math.max(maxX, n.x + 300);
    maxY = Math.max(maxY, n.y + 300);
  });
  if (svg.getAttribute('width') !== String(maxX) || svg.getAttribute('height') !== String(maxY)) {
    svg.style.width = maxX + 'px';
    svg.style.height = maxY + 'px';
    svg.setAttribute('width', maxX);
    svg.setAttribute('height', maxY);
  }

  const shapes = []; // { key, tag, attrs, text? }

  // ---- FLAG LINKS: thin dashed lines between set_flag and secret.flag readers ----
  // Only drawn for links touching the selection: there is one per setter/reader
  // pair, so on big stories drawing them all is slow to paint and unreadable.
  // Build a map: flagName -> { setters: [nodeId, ...], readers: [nodeId, ...] }
  const flagMap = {};
  Object.values(nodes).forEach(n => {
    // setters: choices with set_flag
    (n.choices || []).forEach(c => {
      if (c.set_flag) {
        if (!flagMap[c.set_flag]) flagMap[c.set_flag] = { setters: [], readers: [] };
        if (!flagMap[c.set_flag].setters.includes(n.id)) flagMap[c.set_flag].setters.push(n.id);
      }
    });
    // readers: secret.flag with a flag condition
    if (n.secret && n.secret.flag && (n.secret.condition === 'flag_true' || n.secret.condition === 'flag_false')) {
      const f = n.secret.flag;
      if (!flagMap[f]) flagMap[f] = { setters: [], readers: [] };
      flagMap[f].readers.push(n.id);
    }
  });

  // assign a stable color per flag name
  const FLAG_COLORS = ['var(--warning)','var(--info)','#f2854b','var(--accent-light)','#4bdbd0','#e07be0'];
  const flagColorCache = {};
  let flagColorIdx = 0;
  function getFlagColor(name) {
    if (!flagColorCache[name]) flagColorCache[name] = FLAG_COLORS[flagColorIdx++ % FLAG_COLORS.length];
    return flagColorCache[name];
  }

  Object.entries(flagMap).forEach(([flagName, { setters, readers }]) => {
    const color = getFlagColor(flagName);
    // draw a line from each setter node center to each reader node center
    setters.forEach(sid => {
      readers.forEach(rid => {
        if (sid === rid) return;
        if (!state.selectedNodes.has(sid) && !state.selectedNodes.has(rid)) return;
        const sn = nodes[sid], rn = nodes[rid];
        if (!sn || !rn) return;
        const nodeW = 220, nodeH = 90; // approx
        const sx = sn.x + nodeW / 2;
        const sy = sn.y + nodeH / 2;
        const rx = rn.x + nodeW / 2;
        const ry = rn.y + nodeH / 2;
        const mx = (sx + rx) / 2;
        const my = Math.min(sy, ry) - 40; // arc above
        const key = `flag\u0000${flagName}\u0000${sid}\u0000${rid}`;
        shapes.push({ key, tag: 'path', attrs: {
          d: `M${sx},${sy} Q${mx},${my} ${rx},${ry}`,
          stroke: color, 'stroke-width': '1.2', fill: 'none', 'stroke-opacity': '0.55', 'stroke-dasharray': '4,5'
        } });
        // small flag label at midpoint
        shapes.push({ key: key + '\u0000label', tag: 'text', text: flagName, attrs: {
          x: mx, y: my - 6, 'text-anchor': 'middle', 'font-family': 'var(--font-mono)', 'font-size': '9',
          fill: color, 'fill-opacity': '0.8', style: 'pointer-events:none;'
        } });
      });
    });
  });

  // ---- NORMAL CONNECTIONS ----
  state.connections.forEach(c => {
    const from = getPortCenter(c.from, c.fromPort);
    const to = getPortCenter(c.to, 'in');
    if (!from || !to) return;

    const dx = Math.abs(to.x - from.x) * 0.5;
    let color = 'var(--accent)';
    if (c.fromPort === 'secret') color = 'var(--danger)';
    else if (c.fromPort.startsWith('choice-')) {
      const idx = parseInt(c.fromPort.split('-')[1]);
      const hues = ['var(--success)','#4bc9e0','#8bc94b','#e0c94b'];
      color = hues[idx % hues.length];
    }

    const key = `conn\u0000${c.from}\u0000${c.fromPort}\u0000${c.to}`;
    // stroke-/fill-opacity rather than opacity: per-element opacity makes the
    // browser paint each shape in its own layer, which is very slow when zooming
    shapes.push({ key, tag: 'path', attrs: {
      d: `M${from.x},${from.y} C${from.x+dx},${from.y} ${to.x-dx},${to.y} ${to.x},${to.y}`,
      stroke: color, 'stroke-width': '2', fill: 'none', 'stroke-opacity': '0.7'
    } });
    shapes.push({ key: key + '\u0000end', tag: 'circle', attrs: {
      cx: to.x, cy: to.y, r: '3', fill: color, 'fill-opacity': '0.9'
    } });
  });

  syncShapes(svg, shapes);
  scheduleMinimap(); // called whenever nodes move, change, or the selection changes
}

// Make the SVG contain exactly `shapes`, touching only what changed.
function syncShapes(svg, shapes) {
  const seen = new Set();
  shapes.forEach(({ key, tag, attrs, text }) => {
    seen.add(key);
    const sig = Object.values(attrs).join('|') + '|' + (text || '');
    let entry = drawnShapes.get(key);
    if (!entry) {
      entry = { el: document.createElementNS(SVG_NS, tag), sig: '' };
      svg.appendChild(entry.el);
      drawnShapes.set(key, entry);
    }
    if (entry.sig !== sig) {
      Object.entries(attrs).forEach(([name, value]) => entry.el.setAttribute(name, value));
      if (text !== undefined) entry.el.textContent = text;
      entry.sig = sig;
    }
  });
  drawnShapes.forEach((entry, key) => {
    if (!seen.has(key)) {
      entry.el.remove();
      drawnShapes.delete(key);
    }
  });
}

// ================================
// SELECTION
// ================================
export function updateSelectionVisuals() {
  document.querySelectorAll('.node').forEach(el => {
    el.classList.toggle('selected', state.selectedNodes.has(el.id.replace('node-', '')));
  });
  renderConnections(); // flag links follow the selection
}

export function selectAllNodes() {
  const ids = Object.keys(state.nodes);
  if (ids.length === 0) return;
  state.selectedNodes = new Set(ids);
  state.selectedNode = ids[ids.length - 1];
  updateSelectionVisuals();
  renderSidebar();
}

export function selectNode(id, isMulti = false) {
  const sel = state.selectedNodes;
  if (id === null) {
    sel.clear();
    state.selectedNode = null;
  } else if (isMulti) {
    if (sel.has(id)) {
      sel.delete(id);
      state.selectedNode = lastSelectedId();
    } else {
      sel.add(id);
      state.selectedNode = id;
    }
  } else {
    sel.clear();
    if (state.nodes[id]) {
      sel.add(id);
      state.selectedNode = id;
    } else {
      state.selectedNode = null;
    }
  }

  updateSelectionVisuals();
  renderSidebar();
}

// Replace the selection with the given IDs (last one becomes primary).
export function setSelection(ids) {
  state.selectedNodes = new Set(ids);
  state.selectedNode = ids.length ? ids[ids.length - 1] : null;
}

// ================================
// EMPTY HINT
// ================================
export function updateEmptyHint() {
  document.getElementById('empty-hint').style.display = Object.keys(state.nodes).length ? 'none' : 'block';
}

// ================================
// CONTEXT MENU
// ================================
function showCtxMenu(x, y, hasNode) {
  const menu = document.getElementById('ctx-menu');
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
  menu.classList.add('active');

  menu.querySelectorAll('.node-only').forEach(el => el.style.display = hasNode ? 'block' : 'none');

  const count = state.selectedNodes.size;
  const dupItem = menu.querySelector('[data-action="ctxDuplicateNode"]');
  const copyItem = menu.querySelector('[data-action="ctxCopyNode"]');
  const delItem = menu.querySelector('[data-action="ctxDeleteNode"]');

  if (count > 1) {
    dupItem.textContent = `Duplicate (${count}) (Ctrl+D)`;
    copyItem.textContent = `Copy (${count}) (Ctrl+C)`;
    delItem.textContent = `Delete (${count}) (Del)`;
  } else {
    dupItem.textContent = 'Duplicate (Ctrl+D)';
    copyItem.textContent = 'Copy Node (Ctrl+C)';
    delItem.textContent = 'Delete Node (Del)';
  }

  document.getElementById('ctx-paste').style.display = state.clipboard ? 'block' : 'none';
}

export function hideCtxMenu() { document.getElementById('ctx-menu').classList.remove('active'); }

// Context-menu actions apply to the whole selection when the right-clicked
// node is part of a multi-selection, otherwise to the right-clicked node.
function ctxApply(single, multi) {
  hideCtxMenu();
  if (state.selectedNodes.size > 1 && ctxTarget && state.selectedNodes.has(ctxTarget)) {
    multi();
  } else if (ctxTarget) {
    single(ctxTarget);
  } else if (state.selectedNodes.size > 0) {
    multi();
  }
}

export function ctxAddNode() { hideCtxMenu(); addNode(ctxPos.x, ctxPos.y); }
export function ctxPasteNode() { hideCtxMenu(); pasteNode(ctxPos.x, ctxPos.y); }
export function ctxPlayNode() {
  hideCtxMenu();
  if (ctxTarget) openPlaytest(ctxTarget);
  else if (state.selectedNode) openPlaytest(state.selectedNode);
}
export function ctxDeleteNode() { ctxApply(deleteNode, deleteSelectedNodes); }
export function ctxCopyNode() { ctxApply(copyNode, copySelectedNodes); }
export function ctxDuplicateNode() { ctxApply(duplicateNode, duplicateSelectedNodes); }
