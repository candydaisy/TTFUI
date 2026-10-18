import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceLines, fileName, speakersOf, batchSlots } from '../js/voice-data.js';

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

test('batchSlots picks ticked, cast, unvoiced slots that have text, without pending takes', () => {
  const lines = [
    { id: 'a', speaker: 'K', en: 'Hi', th: 'สวัสดี' },
    { id: 'b', speaker: 'F', en: 'Yo', th: '' },
    { id: 'c', speaker: 'K', en: 'Bye', th: 'ลาก่อน' },
    { id: 'd', speaker: '', en: 'Rain.', th: '' },
  ];
  const slots = batchSlots(lines, {
    ticked: new Set(['a', 'b', 'c', 'd']),
    voices: { K: 'k1', '': 'n1' },          // F is not cast
    files: new Set(['a.mp3']),               // a's English is already voiced
    pending: new Set(['c|th']),              // c's Thai has a take waiting
  });
  assert.deepEqual(slots.map(s => `${s.id}|${s.lang}`), ['a|th', 'c|en', 'd|en']);
  assert.equal(slots.reduce((n, s) => n + s.text.length, 0), 'สวัสดี'.length + 3 + 5);
});
