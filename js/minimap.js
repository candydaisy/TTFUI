// ================================
// MINIMAP: overview of the whole graph; click or drag to move the view
// ================================
import { state } from './state.js';
import { findCharacter } from './graph.js';
import { getNodeSize, panTo } from './canvas.js';

const PREF_KEY = 'ttfui_minimap_visible';
const PAD = 8; // minimap pixels around the content

let visible = true;
let frameRequested = false;
let layout = null;      // canvas -> minimap mapping from the last draw
let dragLayout = null;  // frozen while dragging so the map doesn't shift under the cursor
let colors = null;

// Fit `bounds` (canvas coords {minX, minY, maxX, maxY}) into a width x height
// box with padding, centered. Returns { scale, offsetX, offsetY } such that
// minimapX = canvasX * scale + offsetX.
export function computeMinimapLayout(bounds, width, height, pad = PAD) {
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((width - 2 * pad) / bw, (height - 2 * pad) / bh);
  return {
    scale,
    offsetX: (width - bw * scale) / 2 - bounds.minX * scale,
    offsetY: (height - bh * scale) / 2 - bounds.minY * scale
  };
}

export function setupMinimap() {
  visible = localStorage.getItem(PREF_KEY) !== '0';
  const css = getComputedStyle(document.documentElement);
  const cssVar = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  colors = {
    node: cssVar('--border', '#3f4147'),
    accent: cssVar('--accent', '#5865f2'),
    text: cssVar('--text', '#f2f3f5'),
  };

  const box = document.getElementById('minimap');
  const canvas = document.getElementById('minimap-canvas');

  // keep canvas interactions (marquee, context menu, touch pan) from starting
  const stop = e => e.stopPropagation();
  ['mousedown', 'contextmenu', 'touchstart', 'touchmove', 'touchend', 'wheel'].forEach(type =>
    box.addEventListener(type, stop, { passive: type !== 'contextmenu' && type !== 'wheel' }));
  box.addEventListener('contextmenu', e => e.preventDefault());
  box.addEventListener('wheel', e => e.preventDefault(), { passive: false });

  const moveTo = (clientX, clientY) => {
    if (!dragLayout) return;
    const rect = canvas.getBoundingClientRect();
    panTo(
      (clientX - rect.left - dragLayout.offsetX) / dragLayout.scale,
      (clientY - rect.top - dragLayout.offsetY) / dragLayout.scale
    );
  };
  const endDrag = () => { dragLayout = null; scheduleMinimap(); };

  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0 || !layout) return;
    e.preventDefault();
    dragLayout = layout;
    moveTo(e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', e => { if (dragLayout) moveTo(e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => { if (dragLayout) endDrag(); });

  canvas.addEventListener('touchstart', e => {
    if (!layout || e.touches.length !== 1) return;
    e.preventDefault();
    dragLayout = layout;
    moveTo(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    moveTo(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  canvas.addEventListener('touchend', endDrag);

  window.addEventListener('resize', scheduleMinimap);
  updateToggleButton();
  scheduleMinimap();
}

export function toggleMinimap() {
  visible = !visible;
  localStorage.setItem(PREF_KEY, visible ? '1' : '0');
  updateToggleButton();
  scheduleMinimap();
}

function updateToggleButton() {
  const btn = document.getElementById('minimap-btn');
  if (btn) btn.classList.toggle('active', visible);
}

// Redraw on the next animation frame (many changes per frame cost one draw).
export function scheduleMinimap() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    drawMinimap();
  });
}

function drawMinimap() {
  const box = document.getElementById('minimap');
  const canvas = document.getElementById('minimap-canvas');
  const ids = Object.keys(state.nodes);
  box.style.display = visible && ids.length ? 'block' : 'none';
  if (box.style.display === 'none') { layout = null; return; }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // size the backing store for sharp lines on high-DPI screens
  const width = box.clientWidth, height = box.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // node rectangles in canvas coordinates
  const rects = {};
  ids.forEach(id => {
    const n = state.nodes[id];
    const size = getNodeSize(id) || { w: 250, h: 100 };
    rects[id] = { x: n.x, y: n.y, w: size.w, h: size.h };
  });

  // the visible area of the editor, in canvas coordinates
  const wrap = document.getElementById('canvas-wrap');
  const view = {
    x: -state.pan.x / state.zoom,
    y: -state.pan.y / state.zoom,
    w: wrap.clientWidth / state.zoom,
    h: wrap.clientHeight / state.zoom
  };

  if (dragLayout) {
    layout = dragLayout;
  } else {
    // fit all nodes plus the current view, so the view box is always on the map
    const bounds = { minX: view.x, minY: view.y, maxX: view.x + view.w, maxY: view.y + view.h };
    Object.values(rects).forEach(r => {
      bounds.minX = Math.min(bounds.minX, r.x);
      bounds.minY = Math.min(bounds.minY, r.y);
      bounds.maxX = Math.max(bounds.maxX, r.x + r.w);
      bounds.maxY = Math.max(bounds.maxY, r.y + r.h);
    });
    layout = computeMinimapLayout(bounds, width, height);
  }
  const { scale, offsetX, offsetY } = layout;
  const mx = x => x * scale + offsetX;
  const my = y => y * scale + offsetY;

  // connections: straight lines from the source's right edge to the target's left edge
  ctx.strokeStyle = colors.text;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1;
  ctx.beginPath();
  state.connections.forEach(c => {
    const a = rects[c.from], b = rects[c.to];
    if (!a || !b) return;
    ctx.moveTo(mx(a.x + a.w), my(a.y + a.h / 2));
    ctx.lineTo(mx(b.x), my(b.y + b.h / 2));
  });
  ctx.stroke();
  ctx.globalAlpha = 1;

  // nodes, in their speaker's character color; selected nodes in the accent color
  ids.forEach(id => {
    const r = rects[id];
    const character = findCharacter(state.characters, state.nodes[id].speaker);
    ctx.fillStyle = state.selectedNodes.has(id) ? colors.accent : (character ? character.color : colors.node);
    ctx.fillRect(mx(r.x), my(r.y), Math.max(2, r.w * scale), Math.max(2, r.h * scale));
  });

  // current view
  ctx.strokeStyle = colors.accent;
  ctx.fillStyle = colors.accent;
  ctx.globalAlpha = 0.12;
  ctx.fillRect(mx(view.x), my(view.y), view.w * scale, view.h * scale);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(mx(view.x), my(view.y), view.w * scale, view.h * scale);
}
