import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFlowGraph, buildExportData, formatFlowGraph, buildConnections, analyzeGraph, detectMode,
  evaluateSecretCondition, isChoiceLocked, lineFor, choiceTime, startMeters, conditionsFor,
  startNodeId, createChoice, changeTone
} from '../js/graph.js';

// A small story in the game's layout (tabs, one choice per line), using
// Elysia's mode keys and a key this editor doesn't know about.
const ELYSIA_STORY = `{
	"start": {
		"speaker": "Elysia",
		"text": "\\"I know. Sorry.\\"",
		"real_text": "\\"I'm just tired, Mom.\\"",
		"next": "ask",
		"voice": "ely_1"
	},

	"ask": {
		"speaker": "Ploy",
		"text": "\\"You're coming, right?\\"",
		"timed": true,
		"choices": [
			{"text": "Sure!", "type": "perform", "mask_change": 5, "energy_change": -10, "next": "end"},
			{"text": "I can't.", "type": "honest", "mask_change": -5, "energy_change": 5, "next": "end", "set_flag": "SaidNo"}
		]
	},

	"end": {
		"speaker": "",
		"text": "*Done.*",
		"secret": {"condition": "mask_below", "value": 50, "next": "start"},
		"future_key": {"keep": true}
	}
}
`;

function load(text) {
  const { nodes, mode } = parseFlowGraph(text);
  return { nodes, connections: buildConnections(nodes), mode };
}

test('import -> export gives back the same file (mode keys, voice, unknown keys)', () => {
  const graph = load(ELYSIA_STORY);
  assert.equal(graph.mode, 'elysia');
  assert.equal(formatFlowGraph(buildExportData(graph)), ELYSIA_STORY);
});

test('detectMode picks the mode whose meters the choices use', () => {
  assert.equal(detectMode({ a: { choices: [{ weight_change: 5 }] } }), 'kay');
  assert.equal(detectMode({ a: { choices: [{ mask_change: 5, energy_change: 1 }] } }), 'elysia');
  assert.equal(detectMode({ a: { text: 'no choices' } }), 'kay');
});

test('export only writes the current mode\'s meters and fields', () => {
  const graph = load(ELYSIA_STORY);
  graph.mode = 'kay';
  const data = buildExportData(graph);
  assert.equal(data.start.real_text, undefined);
  assert.equal(data.ask.timed, undefined);
  assert.deepEqual(Object.keys(data.ask.choices[0]), ['text', 'type', 'weight_change', 'next']);
});

test('diagnostics flag keys the mode does not understand', () => {
  const graph = load(ELYSIA_STORY);
  assert.deepEqual(analyzeGraph(graph).filter(i => i.type !== 'info'), []);
  graph.mode = 'kay';
  const titles = analyzeGraph(graph).map(i => i.title);
  assert.ok(titles.some(t => t.startsWith('Unknown Meter')));
  assert.ok(titles.some(t => t.startsWith('Unknown Choice Type ("perform")')));
  assert.ok(titles.some(t => t.startsWith('Ignored Meter Change')));
  assert.ok(titles.includes('Ignored Mode Field'));
});

test('secret conditions work for any meter, and plain numbers mean weight', () => {
  const flags = new Set(['A']);
  assert.equal(evaluateSecretCondition({ condition: 'mask_below', value: '50' }, { mask: 40, energy: 60 }, flags), true);
  assert.equal(evaluateSecretCondition({ condition: 'energy_above', value: '70' }, { mask: 40, energy: 60 }, flags), false);
  assert.equal(evaluateSecretCondition({ condition: 'weight_above', value: '10' }, 20, flags), true);
  assert.equal(evaluateSecretCondition({ condition: 'weight_above', value: '10' }, { mask: 99 }, flags), false);
  assert.equal(evaluateSecretCondition({ condition: 'flag_true', flag: 'A' }, {}, flags), true);
});

test('locks match the game: Kay helpful at 80+, Elysia honest at low energy or high mask', () => {
  assert.equal(isChoiceLocked('kay', { type: 'helpful' }, { weight: 80 }), true);
  assert.equal(isChoiceLocked('kay', { type: 'helpful' }, { weight: 79 }), false);
  assert.equal(isChoiceLocked('kay', { type: 'honest' }, { weight: 100 }), false);
  assert.equal(isChoiceLocked('elysia', { type: 'honest' }, { mask: 86, energy: 60 }), true);
  assert.equal(isChoiceLocked('elysia', { type: 'honest' }, { mask: 60, energy: 19 }), true);
  assert.equal(isChoiceLocked('elysia', { type: 'honest' }, { mask: 85, energy: 20 }), false);
  assert.equal(isChoiceLocked('elysia', { type: 'perform' }, { mask: 100, energy: 0 }), false);
});

test('self-edit and timer follow the mask', () => {
  const n = { text: 'version', realText: 'real', timed: true };
  assert.deepEqual(lineFor('elysia', n, { mask: 60 }), { text: 'version', unsaid: 'real' });
  assert.deepEqual(lineFor('elysia', n, { mask: 59 }), { text: 'real' });
  assert.deepEqual(lineFor('kay', n, { weight: 99 }), { text: 'version' });
  assert.equal(choiceTime('elysia', n, { mask: 0 }), 8);
  assert.equal(choiceTime('elysia', n, { mask: 100 }), 4);
  assert.equal(choiceTime('elysia', { timed: false }, { mask: 0 }), 0);
  assert.equal(choiceTime('kay', n, { weight: 0 }), 0);
});

test('mode helpers', () => {
  assert.deepEqual(startMeters('kay'), { weight: 55 });
  assert.deepEqual(startMeters('elysia'), { mask: 60, energy: 60 });
  assert.deepEqual(conditionsFor('kay'), ['weight_above', 'weight_below', 'flag_true', 'flag_false']);
  assert.deepEqual(Object.keys(createChoice('elysia')).filter(k => k.endsWith('_change')), ['mask_change', 'energy_change']);
  assert.equal(changeTone('elysia', 'energy', 5), 'good');
  assert.equal(changeTone('elysia', 'mask', 5), 'bad');
  assert.equal(changeTone('kay', 'weight', -5), 'good');
});

test('startNodeId prefers "start", then "1"', () => {
  assert.equal(startNodeId({ a: {}, start: {}, 1: {} }), 'start');
  assert.equal(startNodeId({ a: {}, 1: {} }), '1');
  assert.equal(startNodeId({ a: {}, b: {} }), 'a');
});
