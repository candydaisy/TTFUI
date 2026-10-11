import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHTML } from '../js/utils.js';

test('escapeHTML escapes all HTML-significant characters', () => {
  assert.equal(escapeHTML(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
});

test('escapeHTML handles non-strings', () => {
  assert.equal(escapeHTML(null), '');
  assert.equal(escapeHTML(undefined), '');
  assert.equal(escapeHTML(0), '0');
  assert.equal(escapeHTML(-15), '-15');
});
