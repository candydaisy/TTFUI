import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMinimapLayout } from '../js/minimap.js';

const toMap = (l, x, y) => [x * l.scale + l.offsetX, y * l.scale + l.offsetY];

test('computeMinimapLayout fits and centers wide content', () => {
  // 2000 x 500 content in a 220 x 150 box with 8px padding: width-limited
  const l = computeMinimapLayout({ minX: 100, minY: 50, maxX: 2100, maxY: 550 }, 220, 150, 8);
  assert.equal(l.scale, (220 - 16) / 2000);
  const [x0, y0] = toMap(l, 100, 50);
  const [x1, y1] = toMap(l, 2100, 550);
  assert.ok(Math.abs(x0 - 8) < 1e-9 && Math.abs(x1 - 212) < 1e-9);
  // vertically centered
  assert.ok(Math.abs(y0 - (150 - y1)) < 1e-9);
});

test('computeMinimapLayout fits tall content and negative coordinates', () => {
  const l = computeMinimapLayout({ minX: -500, minY: -1000, maxX: 500, maxY: 3000 }, 220, 150, 8);
  assert.equal(l.scale, (150 - 16) / 4000);
  const [, y0] = toMap(l, 0, -1000);
  const [, y1] = toMap(l, 0, 3000);
  assert.ok(Math.abs(y0 - 8) < 1e-9 && Math.abs(y1 - 142) < 1e-9);
  const [cx] = toMap(l, 0, 0);
  assert.ok(Math.abs(cx - 110) < 1e-9);
});

test('computeMinimapLayout handles a zero-size area', () => {
  const l = computeMinimapLayout({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 220, 150, 8);
  assert.ok(Number.isFinite(l.scale) && Number.isFinite(l.offsetX) && Number.isFinite(l.offsetY));
});
