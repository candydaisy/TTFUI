import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceLines, fileName, speakersOf } from '../js/voice-data.js';

const GRAPH = { a: { speaker: 'K', text: 'Hi {there|F}.' }, b: { text: '' }, c: { text: 'Yo' } };

test('voiceLines lists spoken lines in story order with plain English and Thai text', () => {
  assert.deepEqual(voiceLines(GRAPH, { a: { text: 'สวัสดี {นะ|F}' } }), [
    { id: 'a', speaker: 'K', en: 'Hi there.', th: 'สวัสดี นะ' },
    { id: 'c', speaker: '', en: 'Yo', th: '' },
  ]);
});

test('voiceLines without a th.json leaves every Thai line empty', () => {
  assert.deepEqual(voiceLines(GRAPH, null).map(l => l.th), ['', '']);
});

test('fileName adds _th for Thai', () => {
  assert.equal(fileName('12', 'en'), '12.mp3');
  assert.equal(fileName('12', 'th'), '12_th.mp3');
});

test('speakersOf lists each speaker once, narrator as an empty string', () => {
  assert.deepEqual(speakersOf(voiceLines(GRAPH, null)), ['K', '']);
});
