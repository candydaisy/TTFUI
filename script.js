// ================================
// STATE
// ================================
let nodes = {};
let connections = []; // {from, fromPort, to}
let selectedNode = null;
let pan = { x: 60, y: 60 };
let zoom = 1;
let dragging = null; // {nodeId, ox, oy}
let panning = false;
let panStart = {};
let connecting = null; // {nodeId, port, sx, sy}
let nextId = 1;
let ctxTarget = null;
let ctxPos = { x: 0, y: 0 };

// ================================
// INIT
// ================================
window.addEventListener('DOMContentLoaded', () => {
  drawGrid();
  applyTransform();
  setupCanvasEvents();
  setupSearchEvents();
  setupImportEvents();
  const restored = loadFromStorage();
  if (!restored) updateEmptyHint();
  runDiagnostics();
});

// ================================
// GRID
// ================================
function drawGrid() {
  const svg = document.getElementById('grid-svg');
  const W = window.innerWidth, H = window.innerHeight;
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  const size = 28;
  let html = `<defs><pattern id="grid" width="${size}" height="${size}" patternUnits="userSpaceOnUse">
    <path d="M ${size} 0 L 0 0 0 ${size}" fill="none" stroke="#1e1e2a" stroke-width="1"/>
  </pattern></defs>
  <rect width="100%" height="100%" fill="url(#grid)"/>`;
  svg.innerHTML = html;
}

// ================================
// TRANSFORM
// ================================
function applyTransform() {
  const c = document.getElementById('canvas');
  c.style.transform = `translate(${pan.x}px,${pan.y}px) scale(${zoom})`;
  document.getElementById('zoom-label').textContent = Math.round(zoom * 100) + '%';
}

function zoomToward(newZoom) {
  const wrap = document.getElementById('canvas-wrap');
  const rect = wrap.getBoundingClientRect();
  const mx = rect.width / 2;
  const my = rect.height / 2;
  const oldZoom = zoom;
  zoom = Math.max(0.2, Math.min(2.5, newZoom));
  pan.x = mx - (mx - pan.x) * (zoom / oldZoom);
  pan.y = my - (my - pan.y) * (zoom / oldZoom);
  applyTransform();
}
function zoomIn()  { zoomToward(zoom + 0.1); }
function zoomOut() { zoomToward(zoom - 0.1); }
function resetZoom() { zoom = 1; pan = {x:60,y:60}; applyTransform(); }

// ================================
// CANVAS EVENTS
// ================================
function setupCanvasEvents() {
  const wrap = document.getElementById('canvas-wrap');

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const oldZoom = zoom;
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    zoom = Math.max(0.2, Math.min(2.5, zoom + delta));
    // shift pan so the canvas point under the cursor stays fixed
    pan.x = mx - (mx - pan.x) * (zoom / oldZoom);
    pan.y = my - (my - pan.y) * (zoom / oldZoom);
    applyTransform();
  }, { passive: false });

  wrap.addEventListener('mousedown', e => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      panning = true;
      panStart = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      wrap.classList.add('panning');
      e.preventDefault();
    }
    if (e.button === 0 && !e.target.closest('.node') && !e.target.closest('.port')) {
      selectNode(null);
    }
    hideCtxMenu();
  });

  window.addEventListener('mousemove', e => {
    if (panning) {
      pan.x = e.clientX - panStart.x;
      pan.y = e.clientY - panStart.y;
      applyTransform();
    }
    if (dragging) {
      const wrap = document.getElementById('canvas-wrap');
      const rect = wrap.getBoundingClientRect();
      const x = (e.clientX - rect.left - pan.x) / zoom - dragging.ox;
      const y = (e.clientY - rect.top - pan.y) / zoom - dragging.oy;
      nodes[dragging.id].x = Math.max(0, x);
      nodes[dragging.id].y = Math.max(0, y);
      updateNodeEl(dragging.id);
      renderConnections();
      markDirty();
    }
    if (connecting) {
      const svg = document.getElementById('temp-line');
      const line = document.getElementById('temp-line-el');
      svg.style.width = window.innerWidth + 'px';
      svg.style.height = window.innerHeight + 'px';
      svg.style.left = '0'; svg.style.top = '0';
      line.setAttribute('x1', connecting.sx);
      line.setAttribute('y1', connecting.sy);
      line.setAttribute('x2', e.clientX);
      line.setAttribute('y2', e.clientY);
    }
  });

  window.addEventListener('mouseup', e => {
    if (panning) { panning = false; document.getElementById('canvas-wrap').classList.remove('panning'); }
    if (dragging) { dragging = null; }
    if (connecting) {
      const svg = document.getElementById('temp-line');
      svg.style.width = '0'; svg.style.height = '0';
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
  let touches = {};
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
            ox: (touch.clientX - rect.left) / zoom,
            oy: (touch.clientY - rect.top) / zoom
          };
          return;
        }
      }

      // single touch on empty canvas - prepare for tap (add node) or pan
      touchPanStart = { x: touch.clientX - pan.x, y: touch.clientY - pan.y };

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
      touchPanStart = { x: mid.x - pan.x, y: mid.y - pan.y };
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
        const svg = document.getElementById('temp-line');
        const line = document.getElementById('temp-line-el');
        svg.style.width = window.innerWidth + 'px';
        svg.style.height = window.innerHeight + 'px';
        svg.style.left = '0'; svg.style.top = '0';
        line.setAttribute('x1', connecting.sx);
        line.setAttribute('y1', connecting.sy);
        line.setAttribute('x2', touch.clientX);
        line.setAttribute('y2', touch.clientY);
        return;
      }

      // drag node
      if (touchDragNode) {
        const rect = wrap.getBoundingClientRect();
        const x = (touch.clientX - rect.left - pan.x) / zoom - touchDragOffset.ox;
        const y = (touch.clientY - rect.top - pan.y) / zoom - touchDragOffset.oy;
        nodes[touchDragNode].x = Math.max(0, x);
        nodes[touchDragNode].y = Math.max(0, y);
        updateNodeEl(touchDragNode);
        renderConnections();
        markDirty();
        return;
      }

      // single finger pan (only on empty canvas)
      if (touchPanStart) {
        pan.x = touch.clientX - touchPanStart.x;
        pan.y = touch.clientY - touchPanStart.y;
        applyTransform();
      }

    } else if (t.length === 2) {
      // two finger pan + pinch zoom
      const mid = getTouchMid(t[0], t[1]);
      pan.x = mid.x - touchPanStart.x;
      pan.y = mid.y - touchPanStart.y;

      const dist = getTouchDist(t[0], t[1]);
      if (lastPinchDist) {
        const scale = dist / lastPinchDist;
        const newZoom = Math.max(0.2, Math.min(2.5, zoom * scale));
        // zoom toward pinch midpoint
        const rect = wrap.getBoundingClientRect();
        const mx = mid.x - rect.left;
        const my = mid.y - rect.top;
        pan.x = mx - (mx - pan.x) * (newZoom / zoom);
        pan.y = my - (my - pan.y) * (newZoom / zoom);
        zoom = newZoom;
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
        const toId = portEl.dataset.node;
        connections = connections.filter(c => !(c.from === connecting.id && c.fromPort === connecting.port));
        connections.push({ from: connecting.id, fromPort: connecting.port, to: toId });
        if (connecting.port === 'out') nodes[connecting.id].next = toId;
        if (connecting.port === 'secret') nodes[connecting.id].secret.next = toId;
        if (connecting.port.startsWith('choice-')) {
          const idx = parseInt(connecting.port.split('-')[1]);
          if (nodes[connecting.id].choices[idx]) nodes[connecting.id].choices[idx].next = toId;
        }
        updateNodeEl(connecting.id);
        renderConnections();
        renderSidebar();
        markDirty();
      }
      document.getElementById('temp-line').style.width = '0';
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

// ================================
// NODE CREATION
// ================================
function genId() {
  // find next available numeric id
  let id = String(nextId++);
  while (nodes[id]) id = String(nextId++);
  return id;
}

function addNode(x, y) {
  const wrap = document.getElementById('canvas-wrap');
  const rect = wrap.getBoundingClientRect();
  if (x === undefined) {
    x = (rect.width / 2 - pan.x) / zoom;
    y = (rect.height / 2 - pan.y) / zoom;
  } else {
    x = (x - rect.left - pan.x) / zoom;
    y = (y - rect.top - pan.y) / zoom;
  }

  const id = genId();
  nodes[id] = {
    id, x, y,
    speaker: '', emotion: '', text: 'New line.',
    background: '', sfx: '', amb: '',
    showChars: '', hideChars: '', expression: '',
    secret: { condition: '', value: '', flag: '', next: '' },
    choices: []
  };

  createNodeEl(id);
  renderConnections();
  selectNode(id);
  updateEmptyHint();
  markDirty();
}

function createNodeEl(id) {
  const n = nodes[id];
  const el = document.createElement('div');
  el.className = 'node';
  el.id = 'node-' + id;
  el.style.left = n.x + 'px';
  el.style.top = n.y + 'px';

  el.innerHTML = buildNodeHTML(id);
  document.getElementById('nodes-layer').appendChild(el);

  // header drag
  el.querySelector('.node-header').addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    selectNode(id);
    const rect = el.getBoundingClientRect();
    dragging = {
      id,
      ox: (e.clientX - rect.left) / zoom,
      oy: (e.clientY - rect.top) / zoom
    };
  });

  // click to select
  el.addEventListener('mousedown', e => {
    if (e.button === 0) { e.stopPropagation(); selectNode(id); }
  });

  // context menu on node
  el.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    ctxTarget = id;
    ctxPos = { x: e.clientX, y: e.clientY };
    showCtxMenu(e.clientX, e.clientY, true);
  });

  // ports
  setupPorts(el, id);
}

function buildNodeHTML(id) {
  const n = nodes[id];
  const emotionBadge = n.emotion ? `<span class="node-emotion-badge emotion-${n.emotion}">${n.emotion}</span>` : '';

  // ---- detail rows ----
  let detailRows = '';

  if (n.background)
    detailRows += `<div class="node-detail-row">
      <span class="node-detail-label" style="color:var(--success);">bg</span>
      <span class="node-detail-value" style="color:var(--success);">${n.background}</span>
    </div>`;

  if (n.sfx)
    detailRows += `<div class="node-detail-row">
      <span class="node-detail-label" style="color:var(--warning);">sfx</span>
      <span class="node-detail-value" style="color:var(--warning);">▶ ${n.sfx}</span>
    </div>`;

  if (n.amb)
    detailRows += `<div class="node-detail-row">
      <span class="node-detail-label" style="color:var(--info);">amb</span>
      <span class="node-detail-value" style="color:var(--info);">~ ${n.amb}</span>
    </div>`;

  if (n.showChars) {
    const chars = n.showChars.split(',').map(s => s.trim()).filter(Boolean);
    detailRows += `<div class="node-detail-row">
      <span class="node-detail-label" style="color:var(--success);">show</span>
      <span class="node-detail-value" style="color:var(--success);">${chars.join(', ')}</span>
    </div>`;
  }

  if (n.hideChars) {
    const chars = n.hideChars.split(',').map(s => s.trim()).filter(Boolean);
    detailRows += `<div class="node-detail-row">
      <span class="node-detail-label" style="color:var(--danger);">hide</span>
      <span class="node-detail-value" style="color:var(--danger);">${chars.join(', ')}</span>
    </div>`;
  }

  if (n.expression) {
    // expression is "Char:anim, Char2:anim2" - show each pair
    const pairs = n.expression.split(',').map(s => s.trim()).filter(Boolean);
    pairs.forEach(pair => {
      const [char, anim] = pair.split(':').map(s => s.trim());
      detailRows += `<div class="node-detail-row">
        <span class="node-detail-label" style="color:var(--accent-light);">anim</span>
        <span class="node-detail-value" style="color:var(--accent-light);">${char}${anim ? ' → ' + anim : ''}</span>
      </div>`;
    });
  }

  // ---- secret badge ----
  const secretBadge = (n.secret && n.secret.condition)
    ? `<span class="tag tag-secret">secret: ${n.secret.condition}${n.secret.flag ? ' ' + n.secret.flag : ''}${n.secret.value ? ' ' + n.secret.value : ''}</span>`
    : '';

  // ---- choices badge ----
  const choicesBadge = (n.choices && n.choices.length)
    ? `<span class="tag tag-choices">${n.choices.length} choice${n.choices.length > 1 ? 's' : ''}</span>`
    : '';

  const portY = 20;
  const hasChoices = n.choices && n.choices.length > 0;

  let choicePortsHTML = '';
  let choiceRowsHTML = '';
  if (hasChoices) {
    n.choices.forEach((c, i) => {
      const py = 52 + i * 22;
      choiceRowsHTML += `<div class="node-choice-row" style="display:flex;align-items:center;gap:4px;margin-top:4px;padding-right:14px;">
        <span style="font-size:9px;color:var(--accent);font-weight:700;min-width:12px;">${i+1}</span>
        <span style="font-size:10px;color:var(--text-dim);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.text || '...'}</span>
        ${c.set_flag ? `<span style="font-size:9px;color:var(--warning);font-family:var(--font-mono);">⚑${c.set_flag}</span>` : ''}
      </div>`;
      choicePortsHTML += `<div class="port out choice-port" data-node="${id}" data-port="choice-${i}" style="top:${py}px" title="Choice ${i+1}: ${c.text || ''}"></div>`;
    });
  }

  const tagsHTML = (secretBadge || choicesBadge)
    ? `<div class="node-tags" style="margin-top:5px;">${secretBadge}${choicesBadge}</div>`
    : '';

  return `
    <div class="node-header">
      <span class="node-id">${n.id}</span>
      <span class="node-speaker">${n.speaker || '<narrator>'}</span>
      ${emotionBadge}
    </div>
    <div class="node-body">
      <div class="node-text">${n.text || ''}</div>
      ${detailRows ? `<div style="margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,0.05);">${detailRows}</div>` : ''}
      ${choiceRowsHTML}
      ${tagsHTML}
    </div>
    <div class="port in" data-node="${id}" data-port="in" style="top:${portY}px" title="Input"></div>
    ${!hasChoices ? `<div class="port out" data-node="${id}" data-port="out" style="top:${portY}px" title="Next"></div>` : ''}
    ${choicePortsHTML}
    ${n.secret && n.secret.condition ? `<div class="port secret-out" data-node="${id}" data-port="secret" style="top:${portY+22}px" title="Secret route"></div>` : ''}
  `;
}

function updateNodeEl(id) {
  const el = document.getElementById('node-' + id);
  if (!el) return;
  const n = nodes[id];
  el.style.left = n.x + 'px';
  el.style.top = n.y + 'px';
  el.innerHTML = buildNodeHTML(id);
  setupPorts(el, id);

  // re-attach events
  el.querySelector('.node-header').addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.stopPropagation(); selectNode(id);
    const rect = el.getBoundingClientRect();
    dragging = { id, ox: (e.clientX - rect.left)/zoom, oy: (e.clientY - rect.top)/zoom };
  });
  el.addEventListener('mousedown', e => { if(e.button===0){e.stopPropagation();selectNode(id);} });
  el.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    ctxTarget = id; ctxPos = {x:e.clientX,y:e.clientY};
    showCtxMenu(e.clientX, e.clientY, true);
  });

  if (selectedNode === id) el.classList.add('selected');
}

function setupPorts(el, id) {
  el.querySelectorAll('.port').forEach(port => {
    port.addEventListener('mousedown', e => {
      e.stopPropagation();
      if (port.dataset.port === 'in') {
        connections = connections.filter(c => !(c.to === id));
        renderConnections();
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
        connections = connections.filter(c => !(c.from === connecting.id && c.fromPort === connecting.port));
        connections.push({ from: connecting.id, fromPort: connecting.port, to: id });

        // update the correct next reference
        const p = connecting.port;
        if (p === 'out') {
          nodes[connecting.id].next = id;
        } else if (p === 'secret') {
          nodes[connecting.id].secret.next = id;
        } else if (p.startsWith('choice-')) {
          const idx = parseInt(p.split('-')[1]);
          if (nodes[connecting.id].choices[idx]) {
            nodes[connecting.id].choices[idx].next = id;
          }
        }

        updateNodeEl(connecting.id);
        renderConnections();
        renderSidebar();
        markDirty();
      }
      connecting = null;
      document.getElementById('temp-line').style.width = '0';
    });
  });
}

// ================================
// CONNECTIONS
// ================================
function getPortCenter(nodeId, portType) {
  const el = document.getElementById('node-' + nodeId);
  if (!el) return null;
  const port = el.querySelector(`.port[data-port="${portType}"]`);
  if (!port) return null;
  const pRect = port.getBoundingClientRect();
  const wrap = document.getElementById('canvas-wrap').getBoundingClientRect();
  const x = (pRect.left + pRect.width/2 - wrap.left - pan.x) / zoom;
  const y = (pRect.top + pRect.height/2 - wrap.top - pan.y) / zoom;
  return { x, y };
}

function renderConnections() {
  const svg = document.getElementById('connections-svg');

  // dynamically size SVG to cover all nodes with padding
  let maxX = 2000, maxY = 2000;
  Object.values(nodes).forEach(n => {
    maxX = Math.max(maxX, n.x + 300);
    maxY = Math.max(maxY, n.y + 300);
  });
  svg.style.width = maxX + 'px';
  svg.style.height = maxY + 'px';
  svg.setAttribute('width', maxX);
  svg.setAttribute('height', maxY);

  let html = '';

  // ---- FLAG LINKS: thin dashed lines between set_flag and secret.flag readers ----
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
    // draw a line from each setter node center-bottom to each reader node center-top
    setters.forEach(sid => {
      readers.forEach(rid => {
        if (sid === rid) return;
        const sn = nodes[sid], rn = nodes[rid];
        if (!sn || !rn) return;
        // use center of node for both endpoints
        const nodeW = 220, nodeH = 90; // approx
        const sx = sn.x + nodeW / 2;
        const sy = sn.y + nodeH / 2;
        const rx = rn.x + nodeW / 2;
        const ry = rn.y + nodeH / 2;
        const mx = (sx + rx) / 2;
        const my = Math.min(sy, ry) - 40; // arc above
        html += `<path d="M${sx},${sy} Q${mx},${my} ${rx},${ry}"
          stroke="${color}" stroke-width="1.2" fill="none" opacity="0.55"
          stroke-dasharray="4,5"/>`;
        // small flag label at midpoint
        const lx = mx;
        const ly = my - 6;
        html += `<text x="${lx}" y="${ly}" text-anchor="middle"
          font-family="var(--font-mono)" font-size="9" fill="${color}" opacity="0.8"
          style="pointer-events:none;">⚑ ${flagName}</text>`;
      });
    });
    // orphan setters (no readers yet): small badge on the node
    // orphan readers (no setters yet): already visible via secret condition
  });

  // ---- NORMAL CONNECTIONS ----
  connections.forEach((c, i) => {
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

    const path = `M${from.x},${from.y} C${from.x+dx},${from.y} ${to.x-dx},${to.y} ${to.x},${to.y}`;
    html += `<path d="${path}" stroke="${color}" stroke-width="2" fill="none" opacity="0.7"/>
             <circle cx="${to.x}" cy="${to.y}" r="3" fill="${color}" opacity="0.9"/>`;
  });

  svg.innerHTML = html;
}

// ================================
// SELECTION & SIDEBAR
// ================================
function selectNode(id) {
  document.querySelectorAll('.node').forEach(n => n.classList.remove('selected'));
  selectedNode = id;
  if (id) {
    const el = document.getElementById('node-' + id);
    if (el) el.classList.add('selected');
  }
  renderSidebar();
}

function renderSidebar() {
  const content = document.getElementById('sidebar-content');
  if (!selectedNode || !nodes[selectedNode]) {
    content.innerHTML = `<p style="color:var(--text-dim);font-size:12px;margin-top:8px">Select a node to edit it.</p>`;
    return;
  }
  const n = nodes[selectedNode];

  content.innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:12px;">
      <button class="tb-btn" style="flex:1;font-size:11px;padding:6px;" onclick="duplicateNode(selectedNode)">⧉ Duplicate</button>
      <button class="tb-btn" style="flex:1;font-size:11px;padding:6px;" onclick="copyNode(selectedNode)">📋 Copy</button>
    </div>
    <div class="field-group">
      <div class="field-label">Node ID</div>
      <input class="field-input" id="f-id" value="${n.id}" placeholder="e.g. 1, secret_1">
    </div>
    <div class="field-group">
      <div class="field-label">Speaker</div>
      <input class="field-input" id="f-speaker" value="${n.speaker}" placeholder="K, Friend, (empty for narrator)">
    </div>
    <div class="field-group">
      <div class="field-label">Emotion</div>
      <select class="field-input" id="f-emotion">
        <option value="" ${!n.emotion?'selected':''}>- none -</option>
        <option value="angry" ${n.emotion==='angry'?'selected':''}>angry</option>
        <option value="tired" ${n.emotion==='tired'?'selected':''}>tired</option>
        <option value="sad" ${n.emotion==='sad'?'selected':''}>sad</option>
        <option value="nervous" ${n.emotion==='nervous'?'selected':''}>nervous</option>
      </select>
    </div>
    <div class="field-group">
      <div class="field-label">Dialog Text</div>
      <textarea class="field-input" id="f-text" rows="3" placeholder="What the character says...">${n.text}</textarea>
    </div>

    <div class="field-section">Visuals</div>
    <div class="field-group">
      <div class="field-label">Background (node name)</div>
      <input class="field-input" id="f-bg" value="${n.background}" placeholder="bedroom, school...">
    </div>
    <div class="field-group">
      <div class="field-label">Show Characters (comma separated)</div>
      <input class="field-input" id="f-show" value="${n.showChars}" placeholder="K, Friend">
    </div>
    <div class="field-group">
      <div class="field-label">Hide Characters (comma separated)</div>
      <input class="field-input" id="f-hide" value="${n.hideChars}" placeholder="K, Friend">
    </div>
    <div class="field-group">
      <div class="field-label">Expressions (CharName:anim, ...)</div>
      <input class="field-input" id="f-expr" value="${n.expression}" placeholder="K:angry, Friend:smile">
    </div>

    <div class="field-section">Audio</div>
    <div class="field-group">
      <div class="field-label">SFX (one-shot)</div>
      <input class="field-input" id="f-sfx" value="${n.sfx}" placeholder="alarm, door...">
    </div>
    <div class="field-group">
      <div class="field-label">Ambience (looping)</div>
      <input class="field-input" id="f-amb" value="${n.amb}" placeholder="bedroom, school...">
    </div>

    <div class="field-section">Secret Route</div>
    <div class="field-group">
      <div class="field-label">Condition</div>
      <select class="field-input" id="f-secret-cond">
        <option value="" ${!n.secret.condition?'selected':''}>- none -</option>
        <option value="weight_above" ${n.secret.condition==='weight_above'?'selected':''}>weight_above</option>
        <option value="weight_below" ${n.secret.condition==='weight_below'?'selected':''}>weight_below</option>
        <option value="flag_true" ${n.secret.condition==='flag_true'?'selected':''}>flag_true</option>
        <option value="flag_false" ${n.secret.condition==='flag_false'?'selected':''}>flag_false</option>
      </select>
    </div>
    <div class="field-group">
      <div class="field-label">Value (for weight conditions)</div>
      <input class="field-input" id="f-secret-val" value="${n.secret.value}" placeholder="e.g. 20">
    </div>
    <div class="field-group">
      <div class="field-label">Flag (for flag conditions)</div>
      <input class="field-input" id="f-secret-flag" value="${n.secret.flag}" placeholder="was_honest">
    </div>
    <div class="field-group">
      <div class="field-label">Secret Next Node</div>
      <input class="field-input" id="f-secret-next" value="${n.secret.next}" placeholder="secret_1">
    </div>

    <div class="field-section">Choices</div>
    <div class="choices-editor" id="choices-editor">
      ${n.choices.map((c,i) => buildChoiceHTML(i, c)).join('')}
    </div>
    <button class="add-choice-btn" onclick="addChoice()">+ Add Choice</button>

    <button class="delete-node-btn" onclick="deleteSelectedNode()">🗑 Delete Node</button>
  `;

  // live update (all fields except the ID field, which is handled separately below
  // so that renaming - which rebuilds this whole sidebar - doesn't happen on every keystroke)
  ['f-speaker','f-emotion','f-text','f-bg','f-show','f-hide','f-expr','f-sfx','f-amb',
   'f-secret-cond','f-secret-val','f-secret-flag','f-secret-next'].forEach(fid => {
    const el = document.getElementById(fid);
    if (el) el.addEventListener('input', saveFields);
  });

  // ID field only renames on blur / Enter, not on every keystroke, since renaming
  // rebuilds the sidebar DOM and would otherwise kick focus out after one letter.
  const idEl = document.getElementById('f-id');
  if (idEl) {
    idEl.addEventListener('blur', commitIdField);
    idEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); idEl.blur(); }
      else if (e.key === 'Escape') { idEl.value = nodes[selectedNode] ? nodes[selectedNode].id : ''; idEl.blur(); }
    });
  }
}

function commitIdField() {
  if (!selectedNode || !nodes[selectedNode]) return;
  const idEl = document.getElementById('f-id');
  if (!idEl) return;
  const n = nodes[selectedNode];
  const newId = idEl.value.trim();
  if (!newId || newId === n.id) { idEl.value = n.id; return; }
  if (nodes[newId]) { alert('ID "' + newId + '" already exists.'); idEl.value = n.id; return; }
  renameNode(n.id, newId);
}

function buildChoiceHTML(i, c) {
  return `
    <div class="choice-item" id="choice-item-${i}">
      <div class="choice-row">
        <input class="field-input" style="flex:1" placeholder="Button text" value="${c.text||''}" oninput="updateChoice(${i},'text',this.value)">
        <button class="choice-remove" onclick="removeChoice(${i})">×</button>
      </div>
      <div class="choice-row">
        <select class="field-input" style="flex:1" onchange="updateChoice(${i},'type',this.value)">
          <option value="helpful" ${c.type==='helpful'?'selected':''}>helpful</option>
          <option value="neutral" ${c.type==='neutral'?'selected':''}>neutral</option>
          <option value="honest" ${c.type==='honest'?'selected':''}>honest</option>
        </select>
      </div>
      <div class="choice-row">
        <input class="field-input" style="width:70px" type="number" placeholder="weight" value="${c.weight_change||0}" oninput="updateChoice(${i},'weight_change',parseFloat(this.value)||0)">
        <input class="field-input" style="flex:1;margin-left:4px" placeholder="next node" value="${c.next||''}" oninput="updateChoice(${i},'next',this.value)">
      </div>
      <div class="choice-row">
        <input class="field-input" style="flex:1" placeholder="set_flag (optional)" value="${c.set_flag||''}" oninput="updateChoice(${i},'set_flag',this.value)">
      </div>
    </div>
  `;
}

function saveFields() {
  if (!selectedNode || !nodes[selectedNode]) return;
  const n = nodes[selectedNode];

  n.speaker = document.getElementById('f-speaker').value;
  n.emotion = document.getElementById('f-emotion').value;
  n.text = document.getElementById('f-text').value;
  n.background = document.getElementById('f-bg').value;
  n.showChars = document.getElementById('f-show').value;
  n.hideChars = document.getElementById('f-hide').value;
  n.expression = document.getElementById('f-expr').value;
  n.sfx = document.getElementById('f-sfx').value;
  n.amb = document.getElementById('f-amb').value;
  n.secret.condition = document.getElementById('f-secret-cond').value;
  n.secret.value = document.getElementById('f-secret-val').value;
  n.secret.flag = document.getElementById('f-secret-flag').value;
  n.secret.next = document.getElementById('f-secret-next').value;

  updateNodeEl(selectedNode);
  renderConnections();
  markDirty();
}

function renameNode(oldId, newId) {
  if (nodes[newId]) { alert('ID "' + newId + '" already exists.'); return; }
  nodes[newId] = { ...nodes[oldId], id: newId };
  delete nodes[oldId];

  // update connections
  connections.forEach(c => {
    if (c.from === oldId) c.from = newId;
    if (c.to === oldId) c.to = newId;
  });

  // update next references
  Object.values(nodes).forEach(n => {
    if (n.id !== newId) {
      if (n.next === oldId) n.next = newId;
      if (n.secret && n.secret.next === oldId) n.secret.next = newId;
      n.choices && n.choices.forEach(c => { if(c.next===oldId) c.next=newId; });
    }
  });

  const el = document.getElementById('node-' + oldId);
  if (el) { el.id = 'node-' + newId; }
  selectedNode = newId;
  updateNodeEl(newId);
  renderConnections();
  renderSidebar();
}

function addChoice() {
  if (!selectedNode) return;
  nodes[selectedNode].choices.push({ text:'', type:'neutral', weight_change:0, next:'', set_flag:'' });
  renderSidebar();
  updateNodeEl(selectedNode);
  markDirty();
}

function removeChoice(i) {
  if (!selectedNode) return;
  nodes[selectedNode].choices.splice(i, 1);
  renderSidebar();
  updateNodeEl(selectedNode);
  markDirty();
}

function updateChoice(i, key, val) {
  if (!selectedNode) return;
  nodes[selectedNode].choices[i][key] = val;
  updateNodeEl(selectedNode);
  markDirty();
}

// ================================
// DELETE
// ================================
function deleteSelectedNode() {
  if (!selectedNode) return;
  deleteNode(selectedNode);
}

function deleteNode(id) {
  const el = document.getElementById('node-' + id);
  if (el) el.remove();
  delete nodes[id];
  connections = connections.filter(c => c.from !== id && c.to !== id);
  if (selectedNode === id) selectedNode = null;
  renderConnections();
  renderSidebar();
  updateEmptyHint();
  markDirty();
}
// ================================
// CONTEXT MENU & CLIPBOARD
// ================================
let clipboardNode = null;

function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 1500);
}

function copyNode(id) {
  const targetId = id || selectedNode;
  if (!targetId || !nodes[targetId]) return;
  clipboardNode = JSON.parse(JSON.stringify(nodes[targetId]));
  showToast('Copied node ' + targetId);
}

function duplicateNode(id) {
  const targetId = id || selectedNode;
  if (!targetId || !nodes[targetId]) return;
  const src = nodes[targetId];
  const newId = genId();

  const newNode = JSON.parse(JSON.stringify(src));
  newNode.id = newId;
  newNode.x = src.x + 30;
  newNode.y = src.y + 30;
  newNode.next = '';
  if (newNode.secret) newNode.secret.next = '';
  if (newNode.choices) newNode.choices.forEach(c => c.next = '');

  nodes[newId] = newNode;
  createNodeEl(newId);
  selectNode(newId);
  renderConnections();
  updateEmptyHint();
  markDirty();
  showToast('Duplicated to node ' + newId);
}

function pasteNode(screenX, screenY) {
  if (!clipboardNode) return;
  const newId = genId();
  const wrap = document.getElementById('canvas-wrap');
  const rect = wrap.getBoundingClientRect();

  let targetX, targetY;
  if (screenX !== undefined && screenY !== undefined) {
    targetX = (screenX - rect.left - pan.x) / zoom;
    targetY = (screenY - rect.top - pan.y) / zoom;
  } else {
    if (clipboardNode.x !== undefined && clipboardNode.y !== undefined) {
      clipboardNode.x += 30;
      clipboardNode.y += 30;
      targetX = clipboardNode.x;
      targetY = clipboardNode.y;
    } else {
      targetX = (rect.width / 2 - pan.x) / zoom;
      targetY = (rect.height / 2 - pan.y) / zoom;
    }
  }

  const newNode = JSON.parse(JSON.stringify(clipboardNode));
  newNode.id = newId;
  newNode.x = Math.max(0, targetX);
  newNode.y = Math.max(0, targetY);
  newNode.next = '';
  if (newNode.secret) newNode.secret.next = '';
  if (newNode.choices) newNode.choices.forEach(c => c.next = '');

  nodes[newId] = newNode;
  createNodeEl(newId);
  selectNode(newId);
  renderConnections();
  updateEmptyHint();
  markDirty();
  showToast('Pasted node ' + newId);
}

function showCtxMenu(x, y, hasNode) {
  const menu = document.getElementById('ctx-menu');
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
  menu.classList.add('active');

  const nodeOnlyItems = menu.querySelectorAll('.node-only');
  nodeOnlyItems.forEach(el => el.style.display = hasNode ? 'block' : 'none');

  const pasteItem = document.getElementById('ctx-paste');
  if (pasteItem) {
    pasteItem.style.display = clipboardNode ? 'block' : 'none';
  }
}

function hideCtxMenu() { document.getElementById('ctx-menu').classList.remove('active'); }
function ctxAddNode() { hideCtxMenu(); addNode(ctxPos.x, ctxPos.y); }
function ctxDeleteNode() { hideCtxMenu(); if(ctxTarget) deleteNode(ctxTarget); }
function ctxPlayNode() { hideCtxMenu(); if(ctxTarget) openPlaytest(ctxTarget); else if(selectedNode) openPlaytest(selectedNode); }
function ctxCopyNode() { hideCtxMenu(); if(ctxTarget) copyNode(ctxTarget); else if(selectedNode) copyNode(selectedNode); }
function ctxDuplicateNode() { hideCtxMenu(); if(ctxTarget) duplicateNode(ctxTarget); else if(selectedNode) duplicateNode(selectedNode); }
function ctxPasteNode() { hideCtxMenu(); pasteNode(ctxPos.x, ctxPos.y); }

// ================================
// EMPTY HINT
// ================================
function updateEmptyHint() {
  document.getElementById('empty-hint').style.display = Object.keys(nodes).length ? 'none' : 'block';
}

// ================================
// CLEAR
// ================================
function clearAll() {
  if (!confirm('Clear everything? This will also clear the auto-save.')) return;
  document.getElementById('nodes-layer').innerHTML = '';
  nodes = {}; connections = []; selectedNode = null; nextId = 1;
  renderConnections(); renderSidebar(); updateEmptyHint();
  clearSave();
}

// ================================
// AUTO LAYOUT
// ================================
function autoLayout() {
  // simple left-to-right topological layout
  const ids = Object.keys(nodes);
  if (!ids.length) return;

  const levels = {};
  const visited = new Set();

  function assignLevel(id, level) {
    if (visited.has(id)) return;
    visited.add(id);
    levels[id] = Math.max(levels[id] || 0, level);
    const n = nodes[id];
    if (n.next && nodes[n.next]) assignLevel(n.next, level + 1);
    if (n.secret && n.secret.next && nodes[n.secret.next]) assignLevel(n.secret.next, level + 1);
    n.choices && n.choices.forEach(c => { if(c.next && nodes[c.next]) assignLevel(c.next, level+1); });
  }

  // find roots (no incoming connections)
  const hasIncoming = new Set(connections.map(c => c.to));
  const roots = ids.filter(id => !hasIncoming.has(id));
  if (!roots.length) roots.push(ids[0]);
  roots.forEach(r => assignLevel(r, 0));
  ids.forEach(id => { if(levels[id]===undefined) levels[id]=0; });

  const colNodes = {};
  ids.forEach(id => {
    const col = levels[id];
    if (!colNodes[col]) colNodes[col] = [];
    colNodes[col].push(id);
  });

  const colW = 280, rowH = 180;
  Object.entries(colNodes).forEach(([col, nodeIds]) => {
    nodeIds.forEach((id, row) => {
      nodes[id].x = col * colW + 40;
      nodes[id].y = row * rowH + 40;
      updateNodeEl(id);
    });
  });
  renderConnections();
}

// ================================
// LOAD EXAMPLE
// ================================
function loadExample() {
  clearAll();
  nodes = {
    "1": { id:"1", x:40, y:100, speaker:"", emotion:"", text:"Alarm goes off..", background:"", sfx:"alarm", amb:"bedroom", showChars:"", hideChars:"", expression:"", secret:{condition:"",value:"",flag:"",next:""}, choices:[], next:"2" },
    "2": { id:"2", x:310, y:100, speaker:"K", emotion:"tired", text:"mhm...", background:"bedroom", sfx:"", amb:"", showChars:"K", hideChars:"Friend", expression:"K:tired", secret:{condition:"",value:"",flag:"",next:""}, choices:[], next:"3" },
    "3": { id:"3", x:580, y:100, speaker:"K", emotion:"angry", text:"i hate school mornings.", background:"bedroom", sfx:"", amb:"", showChars:"K", hideChars:"Friend", expression:"K:angry", secret:{condition:"",value:"",flag:"",next:""}, choices:[
      {text:"It's fine.", type:"helpful", weight_change:10, next:"4", set_flag:""},
      {text:"Just tired.", type:"neutral", weight_change:5, next:"5", set_flag:""},
      {text:"No. I'm exhausted.", type:"honest", weight_change:-15, next:"6", set_flag:"was_honest"}
    ]},
    "4": { id:"4", x:870, y:0, speaker:"Friend", emotion:"", text:"You always say that.", background:"", sfx:"", amb:"", showChars:"", hideChars:"", expression:"", secret:{condition:"",value:"",flag:"",next:""}, choices:[], next:"7" },
    "5": { id:"5", x:870, y:100, speaker:"Friend", emotion:"", text:"Then rest more.", background:"", sfx:"", amb:"", showChars:"", hideChars:"", expression:"", secret:{condition:"",value:"",flag:"",next:""}, choices:[], next:"7" },
    "6": { id:"6", x:870, y:200, speaker:"Friend", emotion:"", text:"You should talk to someone.", background:"", sfx:"", amb:"", showChars:"", hideChars:"", expression:"", secret:{condition:"",value:"",flag:"",next:""}, choices:[], next:"7" },
    "7": { id:"7", x:1140, y:100, speaker:"K", emotion:"", text:"something feels off.", background:"", sfx:"", amb:"", showChars:"", hideChars:"", expression:"", secret:{condition:"weight_below",value:"1",flag:"",next:"secret_1"}, choices:[], next:"8" },
    "secret_1": { id:"secret_1", x:1140, y:260, speaker:"K", emotion:"sad", text:"...this isn't right.", background:"", sfx:"", amb:"", showChars:"", hideChars:"", expression:"", secret:{condition:"",value:"",flag:"",next:""}, choices:[] },
    "8": { id:"8", x:1400, y:100, speaker:"K", emotion:"", text:"another normal day...", background:"", sfx:"", amb:"", showChars:"", hideChars:"", expression:"", secret:{condition:"",value:"",flag:"",next:""}, choices:[] }
  };
  nextId = 9;

  Object.keys(nodes).forEach(id => createNodeEl(id));

  // rebuild connections from next/secret/choices
  Object.values(nodes).forEach(n => {
    if (n.next && nodes[n.next]) connections.push({from:n.id, fromPort:'out', to:n.next});
    if (n.secret && n.secret.next && nodes[n.secret.next]) connections.push({from:n.id, fromPort:'secret', to:n.secret.next});
    n.choices && n.choices.forEach((c, i) => {
      if (c.next && nodes[c.next]) connections.push({from:n.id, fromPort:`choice-${i}`, to:c.next});
    });
  });

  renderConnections();
  updateEmptyHint();
  markDirty();
}

// ================================
// EXPORT (JSON)
// ================================
function exportCode() {
  const exportData = {};
  const ids = Object.keys(nodes);

  ids.forEach(id => {
    const n = nodes[id];
    const item = {};

    if (n.speaker !== undefined) item.speaker = n.speaker;
    if (n.emotion) item.emotion = n.emotion;
    item.text = n.text || '';

    // next
    const outConn = connections.find(c => c.from === id && c.fromPort === 'out');
    const nextVal = outConn ? outConn.to : (n.next || '');
    if (nextVal && (!n.choices || !n.choices.length)) item.next = nextVal;

    if (n.background) item.background = n.background;
    if (n.showChars) {
      item.show_characters = n.showChars.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (n.hideChars) {
      item.hide_characters = n.hideChars.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (n.expression) {
      const expr = {};
      n.expression.split(',').map(s => s.trim()).filter(Boolean).forEach(p => {
        const [k, v] = p.split(':');
        if (k) expr[k.trim()] = (v || '').trim();
      });
      item.expression = expr;
    }
    if (n.sfx) item.sfx = n.sfx;
    if (n.amb) item.amb = n.amb;

    // secret
    if (n.secret && n.secret.condition) {
      const secretConn = connections.find(c => c.from === id && c.fromPort === 'secret');
      const secretNext = secretConn ? secretConn.to : (n.secret.next || '');
      const secObj = {
        condition: n.secret.condition
      };
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
        const choiceConn = connections.find(conn => conn.from === id && conn.fromPort === `choice-${ci}`);
        const cNext = choiceConn ? choiceConn.to : (c.next || '');
        const choiceObj = {
          text: c.text,
          type: c.type || 'neutral',
          weight_change: Number(c.weight_change) || 0,
          next: cNext
        };
        if (c.set_flag) choiceObj.set_flag = c.set_flag;
        return choiceObj;
      });
    }

    exportData[id] = item;
  });

  const jsonStr = JSON.stringify(exportData, null, 2);
  document.getElementById('output-code').value = jsonStr;
  document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

// Lets the user pick exactly where the exported JSON is saved.
// Uses the native "Save As" file picker where supported (Chrome/Edge),
// and falls back to a normal browser download otherwise.
async function saveCodeToFile(evt) {
  const code = document.getElementById('output-code').value;
  const suggestedName = 'flow_graph.json';
  const btn = evt && evt.target;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(code);
      await writable.close();
      if (btn) { const orig = btn.textContent; btn.textContent = '✓ Saved!'; setTimeout(() => btn.textContent = orig, 1500); }
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user cancelled the picker
    }
  }

  // Fallback: trigger a normal download
  const blob = new Blob([code], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function copyCode() {
  const ta = document.getElementById('output-code');
  ta.select();
  navigator.clipboard.writeText(ta.value).then(() => {
    const btn = document.querySelector('#modal-footer .success');
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = 'Copy to Clipboard', 1500);
  });
}

// ================================
// AUTO SAVE / LOAD
// ================================
const SAVE_KEY = 'flow_editor_autosave';
let saveTimeout = null;
let isDirty = false;

let markDirty = function markDirty() {
  isDirty = true;
  setSaveStatus('unsaved', '● unsaved');
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveToStorage, 1500); // save 1.5s after last change
  if (typeof runDiagnostics === 'function') runDiagnostics();
};

function saveToStorage() {
  try {
    const data = {
      nodes,
      connections,
      pan,
      zoom,
      nextId,
      savedAt: Date.now()
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    isDirty = false;
    setSaveStatus('saved', '⬤ saved');
  } catch(e) {
    setSaveStatus('error', '⚠ save failed');
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.nodes || !Object.keys(data.nodes).length) return false;

    nodes = data.nodes;
    connections = data.connections || [];
    pan = data.pan || { x: 60, y: 60 };
    zoom = data.zoom || 1;
    nextId = data.nextId || 1;

    document.getElementById('nodes-layer').innerHTML = '';
    Object.keys(nodes).forEach(id => createNodeEl(id));
    applyTransform();
    renderConnections();
    updateEmptyHint();

    const ago = Math.round((Date.now() - data.savedAt) / 1000);
    const agoStr = ago < 60 ? `${ago}s ago` : ago < 3600 ? `${Math.round(ago/60)}m ago` : 'a while ago';
    setSaveStatus('saved', `⬤ restored (${agoStr})`);
    setTimeout(() => setSaveStatus('saved', '⬤ saved'), 3000);
    return true;
  } catch(e) {
    return false;
  }
}

function setSaveStatus(state, text) {
  const el = document.getElementById('save-status');
  el.textContent = text;
  el.style.color = state === 'saved' ? 'var(--success)' : state === 'unsaved' ? 'var(--warning)' : 'var(--danger)';
}

function clearSave() {
  localStorage.removeItem(SAVE_KEY);
  setSaveStatus('saved', '⬤ cleared');
}

// hook markDirty into all state-changing functions
const _origUpdateNodeEl = updateNodeEl;

// patch the key mutating operations to call markDirty
function patchForDirty() {
  // we call markDirty manually at mutation points instead of monkey-patching
}

// ================================
// IMPORT (JSON / GDScript)
// ================================
function openImport() {
  document.getElementById('import-overlay').style.display = 'flex';
  document.getElementById('import-code').value = '';
  document.getElementById('import-error').style.display = 'none';
  clearImportFile();
}

function closeImport() {
  document.getElementById('import-overlay').style.display = 'none';
  clearImportFile();
}

function handleFileUpload(evt) {
  const file = evt.target.files && evt.target.files[0];
  if (file) {
    loadJSONFile(file);
  }
}

function loadJSONFile(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const content = e.target.result;
    const codeArea = document.getElementById('import-code');
    if (codeArea) codeArea.value = content;
    const statusEl = document.getElementById('import-file-status');
    const nameEl = document.getElementById('import-file-name');
    if (statusEl && nameEl) {
      nameEl.textContent = `✓ Loaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      statusEl.style.display = 'flex';
    }
    const errEl = document.getElementById('import-error');
    if (errEl) errEl.style.display = 'none';
    showToast(`Loaded ${file.name}`);
  };
  reader.readAsText(file);
}

function clearImportFile() {
  const fileInput = document.getElementById('import-file-input');
  if (fileInput) fileInput.value = '';
  const statusEl = document.getElementById('import-file-status');
  if (statusEl) statusEl.style.display = 'none';
}

function setupImportEvents() {
  const area = document.getElementById('import-code');
  if (!area) return;
  area.addEventListener('dragover', e => {
    e.preventDefault();
    area.style.borderColor = 'var(--accent)';
  });
  area.addEventListener('dragleave', e => {
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

function runImport() {
  const raw = document.getElementById('import-code').value.trim();
  const errEl = document.getElementById('import-error');
  errEl.style.display = 'none';

  if (!raw) { showImportError('Nothing pasted.'); return; }

  try {
    // extract just the dictionary body between the first { and last }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) { showImportError('Could not find a { } block.'); return; }

    let body = raw.slice(start, end + 1);

    // convert GDScript dict syntax to JSON
    body = gdscriptDictToJSON(body);

    const parsed = JSON.parse(body);

    // clear current canvas
    document.getElementById('nodes-layer').innerHTML = '';
    nodes = {}; connections = []; selectedNode = null; nextId = 1;

    // build internal node objects from parsed data
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
          ? Object.entries(entry.expression).map(([k,v]) => `${k}:${v}`).join(', ')
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

    nextId = maxNumericId;

    // create elements
    Object.keys(nodes).forEach(id => createNodeEl(id));

    // rebuild connections
    Object.values(nodes).forEach(n => {
      if (n.next && nodes[n.next]) connections.push({from:n.id, fromPort:'out', to:n.next});
      if (n.secret && n.secret.next && nodes[n.secret.next]) connections.push({from:n.id, fromPort:'secret', to:n.secret.next});
      n.choices.forEach((c, i) => { if(c.next && nodes[c.next]) connections.push({from:n.id, fromPort:`choice-${i}`, to:c.next}); });
    });

    // auto layout since we have no position data
    autoLayout();
    renderConnections();
    updateEmptyHint();
    closeImport();
    markDirty();

  } catch(e) {
    showImportError('Parse error: ' + e.message + '. Make sure you pasted the full flow_graph block.');
  }
}

function showImportError(msg) {
  const el = document.getElementById('import-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function gdscriptDictToJSON(str) {
  // strip GDScript comments
  str = str.replace(/#[^\n]*/g, '');

  // convert GDScript true/false/null to JSON
  str = str.replace(/\btrue\b/g, 'true');
  str = str.replace(/\bfalse\b/g, 'false');
  str = str.replace(/\bnull\b/g, 'null');

  // GDScript uses unquoted keys in some cases - quote any bare word keys before a colon
  // e.g.  speaker: "K"  →  "speaker": "K"
  str = str.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');

  // also handle keys at start of string
  str = str.replace(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/gm, '$1"$2"$3');

  // remove trailing commas before } or ]
  str = str.replace(/,(\s*[}\]])/g, '$1');

  return str;
}

document.getElementById('import-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('import-overlay')) closeImport();
});

// close modal on overlay click
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// ================================
// SHARE - URL & CLIPBOARD
// ================================

function openShareModal() {
  // generate share data
  const shareData = { nodes, connections, nextId };
  const json = JSON.stringify(shareData);

  // compact code: base64-encoded JSON
  const code = btoa(unescape(encodeURIComponent(json)));
  document.getElementById('share-code-area').value = code;

  // URL: current page URL + #share=<code>
  const base = window.location.href.split('#')[0];
  const url = base + '#share=' + code;
  document.getElementById('share-url-input').value = url;

  // clear load area & error
  document.getElementById('load-code-area').value = '';
  document.getElementById('share-load-error').style.display = 'none';

  document.getElementById('share-overlay').style.display = 'flex';
}

function closeShareModal() {
  document.getElementById('share-overlay').style.display = 'none';
}

function copyShareUrl() {
  const val = document.getElementById('share-url-input').value;
  navigator.clipboard.writeText(val).then(() => {
    const btn = document.getElementById('copy-url-btn');
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = 'Copy', 1500);
  });
}

function copyShareCode() {
  const val = document.getElementById('share-code-area').value;
  navigator.clipboard.writeText(val).then(() => {
    const btn = document.getElementById('copy-code-btn');
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = 'Copy Code', 1500);
  });
}

function loadShareCode() {
  const raw = document.getElementById('load-code-area').value.trim();
  const errEl = document.getElementById('share-load-error');
  errEl.style.display = 'none';
  if (!raw) { errEl.textContent = 'Paste a share code first.'; errEl.style.display = 'block'; return; }
  try {
    const json = decodeURIComponent(escape(atob(raw)));
    const data = JSON.parse(json);
    if (!data.nodes) throw new Error('Invalid share code.');
    applyShareData(data);
    closeShareModal();
  } catch(e) {
    errEl.textContent = 'Invalid share code: ' + e.message;
    errEl.style.display = 'block';
  }
}

function applyShareData(data) {
  document.getElementById('nodes-layer').innerHTML = '';
  nodes = data.nodes || {};
  connections = data.connections || [];
  nextId = data.nextId || 1;
  selectedNode = null;
  Object.keys(nodes).forEach(id => createNodeEl(id));
  renderConnections();
  renderSidebar();
  updateEmptyHint();
  markDirty();
}

// auto-load from URL hash on startup
window.addEventListener('DOMContentLoaded', () => {
  const hash = window.location.hash;
  if (hash.startsWith('#share=')) {
    try {
      const code = hash.slice(7);
      const json = decodeURIComponent(escape(atob(code)));
      const data = JSON.parse(json);
      if (data.nodes) {
        applyShareData(data);
        // clean the hash from the URL without reloading
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } catch(e) { /* malformed hash, just ignore */ }
  }
});

document.getElementById('share-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('share-overlay')) closeShareModal();
});

// ================================
// SEARCH (Ctrl+F)
// ================================
let searchResults = [];
let searchIndex = -1;

function setupSearchEvents() {
  const sInput = document.getElementById('search-input');
  if (sInput) {
    sInput.addEventListener('input', runSearch);
  }
}

function openSearch() {
  const bar = document.getElementById('search-bar');
  const input = document.getElementById('search-input');
  if (!bar || !input) return;
  bar.style.display = 'flex';
  input.focus();
  input.select();
  runSearch();
}

function closeSearch() {
  const bar = document.getElementById('search-bar');
  if (bar) bar.style.display = 'none';
  document.querySelectorAll('.node').forEach(el => el.classList.remove('search-focus'));
}

function centerOnNode(id) {
  const n = nodes[id];
  if (!n) return;
  const wrap = document.getElementById('canvas-wrap');
  const rect = wrap.getBoundingClientRect();
  const nodeW = 250;
  const nodeH = 120;
  pan.x = rect.width / 2 - (n.x + nodeW / 2) * zoom;
  pan.y = rect.height / 2 - (n.y + nodeH / 2) * zoom;
  applyTransform();
  selectNode(id);
  highlightSearchNode(id);
}

function highlightSearchNode(id) {
  document.querySelectorAll('.node').forEach(el => el.classList.remove('search-focus'));
  const el = document.getElementById('node-' + id);
  if (el) el.classList.add('search-focus');
}

function runSearch() {
  const input = document.getElementById('search-input');
  const query = (input ? input.value : '').trim().toLowerCase();
  searchResults = [];
  searchIndex = -1;

  if (!query) {
    const countEl = document.getElementById('search-count');
    if (countEl) countEl.textContent = '0/0';
    document.querySelectorAll('.node').forEach(el => el.classList.remove('search-focus'));
    return;
  }

  const allIds = Object.keys(nodes);
  allIds.forEach(id => {
    const n = nodes[id];
    let match = false;
    if (String(n.id).toLowerCase().includes(query)) match = true;
    else if (n.speaker && n.speaker.toLowerCase().includes(query)) match = true;
    else if (n.text && n.text.toLowerCase().includes(query)) match = true;
    else if (n.emotion && n.emotion.toLowerCase().includes(query)) match = true;
    else if (n.background && n.background.toLowerCase().includes(query)) match = true;
    else if (n.sfx && n.sfx.toLowerCase().includes(query)) match = true;
    else if (n.amb && n.amb.toLowerCase().includes(query)) match = true;
    else if (n.secret && (
      (n.secret.condition && n.secret.condition.toLowerCase().includes(query)) ||
      (n.secret.flag && n.secret.flag.toLowerCase().includes(query)) ||
      (n.secret.next && n.secret.next.toLowerCase().includes(query))
    )) match = true;
    else if (n.choices && n.choices.some(c =>
      (c.text && c.text.toLowerCase().includes(query)) ||
      (c.set_flag && c.set_flag.toLowerCase().includes(query)) ||
      (c.next && c.next.toLowerCase().includes(query)) ||
      (c.type && c.type.toLowerCase().includes(query))
    )) match = true;

    if (match) searchResults.push(id);
  });

  const countEl = document.getElementById('search-count');
  if (searchResults.length > 0) {
    searchIndex = 0;
    if (countEl) countEl.textContent = `1/${searchResults.length}`;
    centerOnNode(searchResults[0]);
  } else {
    if (countEl) countEl.textContent = '0/0';
    document.querySelectorAll('.node').forEach(el => el.classList.remove('search-focus'));
  }
}

function searchNext() {
  if (!searchResults.length) return;
  searchIndex = (searchIndex + 1) % searchResults.length;
  const countEl = document.getElementById('search-count');
  if (countEl) countEl.textContent = `${searchIndex + 1}/${searchResults.length}`;
  centerOnNode(searchResults[searchIndex]);
}

function searchPrev() {
  if (!searchResults.length) return;
  searchIndex = (searchIndex - 1 + searchResults.length) % searchResults.length;
  const countEl = document.getElementById('search-count');
  if (countEl) countEl.textContent = `${searchIndex + 1}/${searchResults.length}`;
  centerOnNode(searchResults[searchIndex]);
}

// ================================
// KEYBOARD SHORTCUTS
// ================================
window.addEventListener('keydown', e => {
  const activeEl = document.activeElement;
  const isTextEl = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

  if (e.key === 'Escape') {
    closeModal();
    hideCtxMenu();
    closeShareModal();
    closeSearch();
    return;
  }

  // Ctrl+F / Cmd+F -> Search
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    openSearch();
    return;
  }

  // While typing inside text inputs / textareas:
  if (isTextEl) {
    // Inside the search input specifically, Enter and Shift+Enter navigate
    if (activeEl.id === 'search-input') {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) searchPrev();
        else searchNext();
        return;
      }
    }
    // Let normal browser text selection, typing, copy, paste occur
    return;
  }

  // Ctrl+C / Cmd+C -> Copy selected node
  if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
    if (selectedNode) {
      e.preventDefault();
      copyNode(selectedNode);
    }
    return;
  }

  // Ctrl+V / Cmd+V -> Paste copied node
  if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
    if (clipboardNode) {
      e.preventDefault();
      pasteNode();
    }
    return;
  }

  // Ctrl+D / Cmd+D -> Duplicate selected node (prevent browser bookmark!)
  if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
    if (selectedNode) {
      e.preventDefault();
      duplicateNode(selectedNode);
    }
    return;
  }

  // Delete / Backspace -> Delete selected node
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNode) {
    e.preventDefault();
    deleteSelectedNode();
    return;
  }
});

// ================================
// STORY DIAGNOSTICS & LINTER
// ================================
let diagIssues = [];
let diagCurrentFilter = 'all';

function runDiagnostics() {
  diagIssues = [];
  const ids = Object.keys(nodes);
  if (!ids.length) {
    updateDiagButton();
    return;
  }

  // Set of all flags set in the game across choices
  const setFlags = new Set();
  ids.forEach(id => {
    const n = nodes[id];
    if (n.choices) {
      n.choices.forEach(c => {
        if (c.set_flag && c.set_flag.trim()) {
          setFlags.add(c.set_flag.trim());
        }
      });
    }
  });

  // 1. Broken references (target node does not exist)
  ids.forEach(id => {
    const n = nodes[id];
    const outConn = connections.find(c => c.from === id && c.fromPort === 'out');
    const nextTarget = outConn ? outConn.to : (n.next || '');
    if (nextTarget && !nodes[nextTarget]) {
      diagIssues.push({
        type: 'error',
        nodeId: id,
        title: 'Broken Next Target',
        desc: `Node ${id} points to non-existent target "${nextTarget}".`
      });
    }

    const secretConn = connections.find(c => c.from === id && c.fromPort === 'secret');
    const secretNext = secretConn ? secretConn.to : (n.secret && n.secret.next ? n.secret.next : '');
    if (secretNext && !nodes[secretNext]) {
      diagIssues.push({
        type: 'error',
        nodeId: id,
        title: 'Broken Secret Target',
        desc: `Secret route of Node ${id} points to non-existent target "${secretNext}".`
      });
    }

    if (n.choices) {
      n.choices.forEach((c, i) => {
        const choiceConn = connections.find(conn => conn.from === id && conn.fromPort === `choice-${i}`);
        const cTarget = choiceConn ? choiceConn.to : (c.next || '');
        if (cTarget && !nodes[cTarget]) {
          diagIssues.push({
            type: 'error',
            nodeId: id,
            title: `Broken Choice ${i + 1} Target`,
            desc: `Choice "${c.text || '#' + (i + 1)}" points to non-existent target "${cTarget}".`
          });
        }
      });
    }
  });

  // 2. Unset flags
  ids.forEach(id => {
    const n = nodes[id];
    if (n.secret && (n.secret.condition === 'flag_true' || n.secret.condition === 'flag_false')) {
      const neededFlag = (n.secret.flag || '').trim();
      if (!neededFlag) {
        diagIssues.push({
          type: 'error',
          nodeId: id,
          title: 'Missing Secret Flag Name',
          desc: `Condition "${n.secret.condition}" requires a flag name, but none is specified.`
        });
      } else if (!setFlags.has(neededFlag)) {
        diagIssues.push({
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
  const reachable = new Set();
  const queue = [startId];
  reachable.add(startId);

  while (queue.length) {
    const curr = queue.shift();
    const n = nodes[curr];
    if (!n) continue;

    const outConn = connections.find(c => c.from === curr && c.fromPort === 'out');
    const nxt = outConn ? outConn.to : (n.next || '');
    if (nxt && nodes[nxt] && !reachable.has(nxt)) {
      reachable.add(nxt);
      queue.push(nxt);
    }

    const secretConn = connections.find(c => c.from === curr && c.fromPort === 'secret');
    const sNxt = secretConn ? secretConn.to : (n.secret && n.secret.next ? n.secret.next : '');
    if (sNxt && nodes[sNxt] && !reachable.has(sNxt)) {
      reachable.add(sNxt);
      queue.push(sNxt);
    }

    if (n.choices) {
      n.choices.forEach((c, i) => {
        const choiceConn = connections.find(conn => conn.from === curr && conn.fromPort === `choice-${i}`);
        const cNxt = choiceConn ? choiceConn.to : (c.next || '');
        if (cNxt && nodes[cNxt] && !reachable.has(cNxt)) {
          reachable.add(cNxt);
          queue.push(cNxt);
        }
      });
    }
  }

  ids.forEach(id => {
    if (!reachable.has(id) && id !== startId) {
      diagIssues.push({
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
      const outConn = connections.find(c => c.from === id && c.fromPort === 'out');
      const hasDirectNext = Boolean(outConn ? outConn.to : (n.next || ''));
      const hasChoices = Boolean(n.choices && n.choices.length);
      const secretConn = connections.find(c => c.from === id && c.fromPort === 'secret');
      const hasSecret = Boolean(secretConn ? secretConn.to : (n.secret && n.secret.next));

      if (!hasDirectNext && !hasChoices && !hasSecret) {
        diagIssues.push({
          type: 'info',
          nodeId: id,
          title: 'Story End / Dead End',
          desc: `Node ${id} has no choices or outgoing connections.`
        });
      }
    });
  }

  updateDiagButton();
  renderDiagList();
}

function updateDiagButton() {
  const btn = document.getElementById('diag-btn');
  if (!btn) return;
  const errors = diagIssues.filter(i => i.type === 'error').length;
  const warnings = diagIssues.filter(i => i.type === 'warning').length;

  if (errors > 0) {
    btn.innerHTML = `🛑 ${errors} Error${errors > 1 ? 's' : ''}`;
    btn.style.color = 'var(--danger)';
  } else if (warnings > 0) {
    btn.innerHTML = `⚠ ${warnings} Issue${warnings > 1 ? 's' : ''}`;
    btn.style.color = 'var(--warning)';
  } else {
    btn.innerHTML = `✔ Graph Valid`;
    btn.style.color = 'var(--success)';
  }
}

function toggleDiagnostics() {
  const overlay = document.getElementById('diag-overlay');
  if (!overlay) return;
  if (overlay.style.display === 'flex') {
    closeDiagnostics();
  } else {
    runDiagnostics();
    overlay.style.display = 'flex';
  }
}

function closeDiagnostics() {
  const overlay = document.getElementById('diag-overlay');
  if (overlay) overlay.style.display = 'none';
}

function filterDiag(type) {
  diagCurrentFilter = type;
  document.querySelectorAll('.diag-filter').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById(`diag-btn-${type}`);
  if (activeBtn) activeBtn.classList.add('active');
  renderDiagList();
}

function renderDiagList() {
  const list = document.getElementById('diag-list');
  if (!list) return;

  const total = diagIssues.length;
  const errors = diagIssues.filter(i => i.type === 'error').length;
  const warnings = diagIssues.filter(i => i.type === 'warning').length;
  const infos = diagIssues.filter(i => i.type === 'info').length;

  const allCnt = document.getElementById('diag-all-cnt');
  const errCnt = document.getElementById('diag-err-cnt');
  const warnCnt = document.getElementById('diag-warn-cnt');
  const infoCnt = document.getElementById('diag-info-cnt');
  const badgeSum = document.getElementById('diag-badge-summary');

  if (allCnt) allCnt.textContent = total;
  if (errCnt) errCnt.textContent = errors;
  if (warnCnt) warnCnt.textContent = warnings;
  if (infoCnt) infoCnt.textContent = infos;
  if (badgeSum) badgeSum.textContent = `${total} Issue${total === 1 ? '' : 's'}`;

  const filtered = diagCurrentFilter === 'all' ? diagIssues : diagIssues.filter(i => i.type === diagCurrentFilter);

  if (!filtered.length) {
    list.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-dim);font-size:13px;">
      ${total === 0 ? '🎉 All good! No issues detected in the graph.' : 'No issues found in this category.'}
    </div>`;
    return;
  }

  let html = '';
  filtered.forEach(issue => {
    const icon = issue.type === 'error' ? '🛑' : (issue.type === 'warning' ? '⚠' : 'ℹ');
    html += `
      <div class="diag-issue ${issue.type}" onclick="diagJumpToNode('${issue.nodeId}')">
        <div class="diag-issue-content">
          <div class="diag-issue-title"><span>${icon}</span> ${issue.title}</div>
          <div class="diag-issue-desc">${issue.desc}</div>
        </div>
        <div class="diag-node-tag">Node ${issue.nodeId} ↗</div>
      </div>
    `;
  });
  list.innerHTML = html;
}

function diagJumpToNode(id) {
  closeDiagnostics();
  centerOnNode(id);
}

// ================================
// PLAYTEST / STORY PREVIEW
// ================================
let playtestState = {
  activeNodeId: null,
  weight: 0,
  flags: new Set(),
  history: []
};

function openPlaytest(startNodeId) {
  const ids = Object.keys(nodes);
  if (!ids.length) {
    showToast('Add nodes before playtesting.');
    return;
  }

  let startId = startNodeId;
  if (!startId) {
    if (selectedNode && nodes[selectedNode]) startId = selectedNode;
    else if (nodes["1"]) startId = "1";
    else startId = ids[0];
  }

  playtestState = {
    activeNodeId: startId,
    weight: 0,
    flags: new Set(),
    history: []
  };

  const overlay = document.getElementById('playtest-overlay');
  if (overlay) overlay.style.display = 'flex';
  renderPlaytestStep();
}

function closePlaytest() {
  const overlay = document.getElementById('playtest-overlay');
  if (overlay) overlay.style.display = 'none';
  document.querySelectorAll('.node').forEach(el => el.classList.remove('search-focus'));
}

function restartPlaytest() {
  let startId = nodes["1"] ? "1" : Object.keys(nodes)[0];
  playtestState = {
    activeNodeId: startId,
    weight: 0,
    flags: new Set(),
    history: []
  };
  renderPlaytestStep();
}

function renderPlaytestStep() {
  const currId = playtestState.activeNodeId;
  if (!currId || !nodes[currId]) {
    renderPlaytestEnd(false);
    return;
  }

  const n = nodes[currId];

  // Center and highlight node on canvas
  centerOnNode(currId);

  // Top Bar HUD
  document.getElementById('pt-node-badge').textContent = `Node ${n.id}`;
  document.getElementById('pt-weight-val').textContent = playtestState.weight;

  const flagsArr = Array.from(playtestState.flags);
  document.getElementById('pt-flags-val').textContent = flagsArr.length ? flagsArr.join(', ') : 'none';

  // Secret route preview banner
  const secretBanner = document.getElementById('pt-secret-banner');
  let secretWillTrigger = false;
  if (n.secret && n.secret.condition && n.secret.next) {
    secretWillTrigger = evaluateSecretCondition(n.secret, playtestState.weight, playtestState.flags);
  }
  if (secretWillTrigger) {
    secretBanner.style.display = 'flex';
    secretBanner.innerHTML = `⚡ Secret route condition met (${n.secret.condition})! Next step will divert to Node ${n.secret.next}.`;
  } else {
    secretBanner.style.display = 'none';
  }

  // Scene Tags
  function setSceneTag(tagId, valId, val) {
    const el = document.getElementById(tagId);
    const vEl = document.getElementById(valId);
    if (val && val.trim()) {
      vEl.textContent = val.trim();
      el.style.display = 'inline-flex';
    } else {
      el.style.display = 'none';
    }
  }
  setSceneTag('pt-bg-tag', 'pt-bg-val', n.background);
  setSceneTag('pt-show-tag', 'pt-show-val', n.showChars);
  setSceneTag('pt-hide-tag', 'pt-hide-val', n.hideChars);
  setSceneTag('pt-sfx-tag', 'pt-sfx-val', n.sfx);
  setSceneTag('pt-amb-tag', 'pt-amb-val', n.amb);

  // Dialogue Box
  const speakerNameEl = document.getElementById('pt-speaker-name');
  speakerNameEl.textContent = n.speaker ? n.speaker : '(Narrator)';
  speakerNameEl.style.color = n.speaker ? 'var(--accent)' : 'var(--text-muted)';

  const emotionTag = document.getElementById('pt-emotion-tag');
  if (n.emotion) {
    emotionTag.textContent = n.emotion;
    emotionTag.style.display = 'inline-block';
  } else {
    emotionTag.style.display = 'none';
  }

  document.getElementById('pt-dialogue-text').textContent = n.text || '...';

  // Actions: Choices vs Continue
  const choicesContainer = document.getElementById('pt-choices-container');
  const advanceContainer = document.getElementById('pt-advance-container');

  if (n.choices && n.choices.length > 0) {
    choicesContainer.style.display = 'flex';
    advanceContainer.style.display = 'none';

    let html = '';
    n.choices.forEach((c, idx) => {
      let metaHtml = '';
      if (c.weight_change) {
        const wc = Number(c.weight_change);
        const cls = wc > 0 ? 'pt-badge-pos' : 'pt-badge-neg';
        const sign = wc > 0 ? '+' : '';
        metaHtml += `<span class="${cls}">${sign}${wc} weight</span>`;
      }
      if (c.set_flag) {
        metaHtml += `<span class="pt-badge-flag">+flag: ${c.set_flag}</span>`;
      }
      if (c.type) {
        metaHtml += `<span style="opacity:0.6;font-size:10px;">[${c.type}]</span>`;
      }

      html += `
        <button class="pt-choice-btn" onclick="selectPlaytestChoice(${idx})">
          <span>${c.text || '(Choice ' + (idx + 1) + ')'}</span>
          <div class="pt-choice-meta">${metaHtml}</div>
        </button>
      `;
    });
    choicesContainer.innerHTML = html;
  } else {
    choicesContainer.style.display = 'none';
    advanceContainer.style.display = 'flex';

    const outConn = connections.find(c => c.from === currId && c.fromPort === 'out');
    const nextTarget = outConn ? outConn.to : (n.next || '');

    const nextBtn = document.getElementById('pt-next-btn');
    if (secretWillTrigger) {
      nextBtn.textContent = `Secret Route ▶ (Space)`;
      nextBtn.className = 'tb-btn warning';
    } else if (nextTarget && nodes[nextTarget]) {
      nextBtn.textContent = `Continue ▶ (Space)`;
      nextBtn.className = 'tb-btn success';
    } else {
      nextBtn.textContent = `End Flow ★`;
      nextBtn.className = 'tb-btn';
    }
  }
}

function evaluateSecretCondition(secret, weight, flags) {
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

function selectPlaytestChoice(idx) {
  const currId = playtestState.activeNodeId;
  const n = nodes[currId];
  if (!n || !n.choices || !n.choices[idx]) return;

  const choice = n.choices[idx];

  playtestState.history.push({
    nodeId: currId,
    weight: playtestState.weight,
    flags: new Set(playtestState.flags)
  });

  if (choice.weight_change) {
    const delta = Number(choice.weight_change);
    playtestState.weight += delta;
    flashWeightDelta(delta);
  }

  if (choice.set_flag && choice.set_flag.trim()) {
    playtestState.flags.add(choice.set_flag.trim());
  }

  const choiceConn = connections.find(c => c.from === currId && c.fromPort === `choice-${idx}`);
  const nextTarget = choiceConn ? choiceConn.to : (choice.next || '');

  if (nextTarget && nodes[nextTarget]) {
    playtestState.activeNodeId = nextTarget;
    renderPlaytestStep();
  } else {
    renderPlaytestEnd(true);
  }
}

function playtestNext() {
  const currId = playtestState.activeNodeId;
  const n = nodes[currId];
  if (!n) return;

  if (n.choices && n.choices.length > 0) return;

  if (n.secret && n.secret.condition && n.secret.next) {
    if (evaluateSecretCondition(n.secret, playtestState.weight, playtestState.flags)) {
      if (nodes[n.secret.next]) {
        playtestState.activeNodeId = n.secret.next;
        renderPlaytestStep();
        return;
      }
    }
  }

  const outConn = connections.find(c => c.from === currId && c.fromPort === 'out');
  const nextTarget = outConn ? outConn.to : (n.next || '');

  if (nextTarget && nodes[nextTarget]) {
    playtestState.activeNodeId = nextTarget;
    renderPlaytestStep();
  } else {
    renderPlaytestEnd(true);
  }
}

function flashWeightDelta(delta) {
  const el = document.getElementById('pt-weight-delta');
  if (!el) return;
  const sign = delta > 0 ? '+' : '';
  el.textContent = `(${sign}${delta})`;
  el.style.color = delta > 0 ? 'var(--success)' : 'var(--danger)';
  el.style.display = 'inline';
  setTimeout(() => { if (el) el.style.display = 'none'; }, 1500);
}

function renderPlaytestEnd(reachedEnd) {
  const choicesContainer = document.getElementById('pt-choices-container');
  const advanceContainer = document.getElementById('pt-advance-container');
  choicesContainer.style.display = 'none';
  advanceContainer.style.display = 'none';

  document.getElementById('pt-secret-banner').style.display = 'none';
  document.getElementById('pt-speaker-name').textContent = '★ Story Completed';
  document.getElementById('pt-emotion-tag').style.display = 'none';

  const flagsArr = Array.from(playtestState.flags);
  const flagsStr = flagsArr.length ? flagsArr.map(f => `<code style="background:var(--surface2);padding:2px 5px;border-radius:3px;color:var(--accent-light);">${f}</code>`).join(', ') : 'none';

  document.getElementById('pt-dialogue-text').innerHTML = `
    <div style="line-height:1.8;">
      You have reached the end of this story path.<br>
      <strong>Final Weight:</strong> <span style="color:var(--accent);">${playtestState.weight}</span><br>
      <strong>Collected Story Flags:</strong> ${flagsStr}
    </div>
    <div style="margin-top:16px;">
      <button class="tb-btn success" onclick="restartPlaytest()">↺ Play Again</button>
      <button class="tb-btn" onclick="closePlaytest()" style="margin-left:8px;">Exit Preview</button>
    </div>
  `;
}

// Attach Playtest / Diag listeners to global keydown
window.addEventListener('keydown', e => {
  const ptOverlay = document.getElementById('playtest-overlay');
  const isPlaytestOpen = ptOverlay && ptOverlay.style.display === 'flex';

  if (isPlaytestOpen) {
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

  const diagOverlay = document.getElementById('diag-overlay');
  if (diagOverlay && diagOverlay.style.display === 'flex' && e.key === 'Escape') {
    e.preventDefault();
    closeDiagnostics();
    return;
  }

  const activeEl = document.activeElement;
  const isTextEl = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

  if (!isTextEl && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    openPlaytest();
  }
});


