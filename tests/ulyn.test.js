import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFlowGraph, buildExportData, formatFlowGraph, buildConnections, analyzeGraph,
  isChoiceLocked, lineFor, choiceTime, timeoutChoiceIndex, visibleChoices, noticesIn, plainText, startMeters
} from '../js/graph.js';

// Ulyn's keys in the game's layout: calls, cut-off thoughts, quiet lines,
// details to notice, and a choice that requires one.
const ULYN_STORY = `{
	"start": {
		"speaker": "Ulyn",
		"text": "It's my favorite. She knows it's my favorite. That's why she says it.",
		"cut_after": "She knows it's my favorite.",
		"cut": "Anyway. Council at eight.",
		"next": "pres"
	},

	"pres": {
		"speaker": "",
		"text": "*Kay's face doesn't move, but {one thumb presses into his palm|NoticedKayThumb}.*",
		"quiet": true,
		"next": "call"
	},

	"call": {
		"speaker": "",
		"text": "*Mom.*",
		"call": "Mom",
		"choices": [
			{"text": "Decline", "type": "neutral", "busy_change": 5, "unsaid_change": 5, "next": "end"},
			{"text": "Answer", "type": "open", "busy_change": -10, "unsaid_change": -10, "next": "end", "set_flag": "AnsweredMom"},
			{"text": "You were pressing your thumb.", "type": "honest", "busy_change": 0, "unsaid_change": -5, "next": "end", "requires": "NoticedKayThumb"}
		]
	},

	"end": {
		"speaker": "",
		"text": "*Done.*",
		"secret": {"condition": "unsaid_below", "value": 35, "next": "start"}
	}
}
`;

const load = text => {
  const { nodes, mode } = parseFlowGraph(text);
  return { nodes, connections: buildConnections(nodes), mode };
};

test('Ulyn story imports as UlynMode and exports back identically', () => {
  const graph = load(ULYN_STORY);
  assert.equal(graph.mode, 'ulyn');
  assert.equal(formatFlowGraph(buildExportData(graph)), ULYN_STORY);
  assert.deepEqual(analyzeGraph(graph).filter(i => i.type !== 'info'), []);
});

test('cut-off thoughts break off at busy 60+', () => {
  const { nodes } = load(ULYN_STORY);
  assert.deepEqual(lineFor('ulyn', nodes.start, { busy: 60 }),
    { unsaid: "It's my favorite. She knows it's my favorite.—", text: 'Anyway. Council at eight.', cut: true });
  assert.deepEqual(lineFor('ulyn', nodes.start, { busy: 59 }), { text: nodes.start.text });
});

test('open choices lock above busy 80; honest and helpful never do', () => {
  assert.equal(isChoiceLocked('ulyn', { type: 'open' }, { busy: 81 }), true);
  assert.equal(isChoiceLocked('ulyn', { type: 'open' }, { busy: 80 }), false);
  assert.equal(isChoiceLocked('ulyn', { type: 'honest' }, { busy: 100 }), false);
  assert.equal(isChoiceLocked('ulyn', { type: 'helpful' }, { busy: 100 }), false);
  assert.deepEqual(startMeters('ulyn'), { busy: 60, unsaid: 50 });
});

test('calls ring for 6 seconds and ringing out declines', () => {
  const { nodes } = load(ULYN_STORY);
  assert.equal(choiceTime('ulyn', nodes.call, { busy: 60 }), 6);
  assert.equal(choiceTime('kay', nodes.call, { weight: 50 }), 0, 'only modes with calls time them');
  assert.equal(timeoutChoiceIndex('ulyn', nodes.call.choices, { busy: 60 }), 0);
  assert.equal(timeoutChoiceIndex('elysia', [{ type: 'honest' }, { type: 'perform' }], { mask: 50, energy: 50 }), 1);
});

test('requires hides a choice until its flag is set', () => {
  const { nodes } = load(ULYN_STORY);
  assert.deepEqual(visibleChoices(nodes.call.choices, new Set()).map(x => x.i), [0, 1]);
  assert.deepEqual(visibleChoices(nodes.call.choices, new Set(['NoticedKayThumb'])).map(x => x.i), [0, 1, 2]);
});

test('noticesIn / plainText read {detail|Flag} markup', () => {
  const text = "*Kay's face doesn't move, but {one thumb presses into his palm|NoticedKayThumb}.*";
  assert.deepEqual(noticesIn(text), [{ text: 'one thumb presses into his palm', flag: 'NoticedKayThumb' }]);
  assert.equal(plainText(text), "*Kay's face doesn't move, but one thumb presses into his palm.*");
  assert.deepEqual(noticesIn('no details'), []);
});

test('diagnostics: requires nobody sets, bad cut point, call without choices', () => {
  const graph = load(ULYN_STORY);
  graph.nodes.pres.text = 'no detail any more';
  graph.nodes.start.cutAfter = 'not in the text';
  graph.nodes.end.call = 'Dad';
  const titles = analyzeGraph(graph).map(i => i.title);
  assert.ok(titles.includes('Choice Can Never Show ("NoticedKayThumb")'));
  assert.ok(titles.includes('Cut Point Not In Text'));
  assert.ok(titles.includes('Call Without Choices'));
});
