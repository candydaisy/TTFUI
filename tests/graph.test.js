import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNode, splitList, getTarget, buildConnections, remapRefs, remapConnections,
  computeLayout, buildExportData, extractDictBody, gdscriptDictToJSON, parseFlowGraph,
  encodeShareCode, decodeShareCode, evaluateSecretCondition, nodeMatchesQuery,
  analyzeGraph, exampleGraph
} from '../js/graph.js';

// Build a graph from compact node specs: { id: { ...overrides } }
function graphOf(specs, connections) {
  const nodes = {};
  Object.entries(specs).forEach(([id, over]) => {
    nodes[id] = { ...createNode(id, 0, 0), next: '', ...over };
  });
  return { nodes, connections: connections || buildConnections(nodes) };
}

const titles = issues => issues.map(i => `${i.type}:${i.nodeId}:${i.title}`).sort();

test('splitList trims and drops empties', () => {
  assert.deepEqual(splitList(' K, Friend ,,  '), ['K', 'Friend']);
  assert.deepEqual(splitList(''), []);
  assert.deepEqual(splitList(undefined), []);
});

test('getTarget prefers connections over stored refs', () => {
  const g = graphOf({ a: { next: 'b' }, b: {}, c: {} }, [{ from: 'a', fromPort: 'out', to: 'c' }]);
  assert.equal(getTarget(g, 'a', 'out'), 'c');
  g.connections = [];
  assert.equal(getTarget(g, 'a', 'out'), 'b');
  assert.equal(getTarget(g, 'b', 'out'), '');
  assert.equal(getTarget(g, 'missing', 'out'), '');
});

test('getTarget resolves secret and choice ports', () => {
  const g = graphOf({
    a: { secret: { condition: 'flag_true', flag: 'f', value: '', next: 's' }, choices: [{ text: 'x', next: 'b' }] },
    b: {}, s: {}
  }, []);
  assert.equal(getTarget(g, 'a', 'secret'), 's');
  assert.equal(getTarget(g, 'a', 'choice-0'), 'b');
  assert.equal(getTarget(g, 'a', 'choice-5'), '');
});

test('buildConnections only links to existing nodes', () => {
  const { nodes } = graphOf({
    a: { next: 'b', secret: { condition: 'weight_above', value: '1', flag: '', next: 'gone' } },
    b: { choices: [{ next: 'a' }, { next: '' }] }
  }, []);
  assert.deepEqual(buildConnections(nodes), [
    { from: 'a', fromPort: 'out', to: 'b' },
    { from: 'b', fromPort: 'choice-0', to: 'a' }
  ]);
});

test('remapRefs rewrites copied refs and clears outside refs', () => {
  const node = { next: 'a', secret: { next: 'z' }, choices: [{ next: 'b' }, { next: 'z' }] };
  remapRefs(node, { a: '10', b: '11' });
  assert.equal(node.next, '10');
  assert.equal(node.secret.next, '');
  assert.deepEqual(node.choices.map(c => c.next), ['11', '']);
});

test('remapConnections keeps only internal connections', () => {
  const conns = [
    { from: 'a', fromPort: 'out', to: 'b' },
    { from: 'b', fromPort: 'out', to: 'z' }
  ];
  assert.deepEqual(remapConnections(conns, { a: '1', b: '2' }), [{ from: '1', fromPort: 'out', to: '2' }]);
});

test('computeLayout places nodes in columns by depth', () => {
  const g = graphOf({ a: { next: 'b' }, b: { choices: [{ next: 'c' }, { next: 'd' }] }, c: {}, d: {} });
  const pos = computeLayout(g);
  assert.deepEqual(pos.a, { x: 40, y: 40 });
  assert.deepEqual(pos.b, { x: 320, y: 40 });
  assert.equal(pos.c.x, 600);
  assert.equal(pos.d.x, 600);
  assert.notEqual(pos.c.y, pos.d.y);
  assert.deepEqual(computeLayout({ nodes: {}, connections: [] }), {});
});

test('buildExportData produces the game format', () => {
  const g = graphOf({
    1: { speaker: 'K', emotion: 'sad', text: 'hi', next: '2', showChars: 'K, Friend', expression: 'K:tired, Friend:smile', sfx: 'door' },
    2: { text: 'bye', secret: { condition: 'weight_below', value: '5', flag: '', next: '1' } },
    3: { choices: [{ text: 'go', type: '', weight_change: '3', next: '1', set_flag: 'f' }], next: '2' }
  });
  const out = buildExportData(g);
  assert.deepEqual(out['1'], {
    speaker: 'K', emotion: 'sad', text: 'hi', next: '2',
    show_characters: ['K', 'Friend'], expression: { K: 'tired', Friend: 'smile' }, sfx: 'door'
  });
  assert.deepEqual(out['2'].secret, { condition: 'weight_below', value: 5, next: '1' });
  // nodes with choices don't export `next`; choice fields are normalised
  assert.equal(out['3'].next, undefined);
  assert.deepEqual(out['3'].choices, [{ text: 'go', type: 'neutral', weight_change: 3, next: '1', set_flag: 'f' }]);
});

test('export -> import round-trips the example story', () => {
  const ex = exampleGraph();
  const g = { nodes: ex.nodes, connections: buildConnections(ex.nodes) };
  const exported = buildExportData(g);
  const { nodes, nextId } = parseFlowGraph(JSON.stringify(exported));
  assert.equal(nextId, 9);
  const reexported = buildExportData({ nodes, connections: buildConnections(nodes) });
  assert.deepEqual(reexported, exported);
});

test('extractDictBody finds the outer braces', () => {
  assert.equal(extractDictBody('var flow_graph = { "a": {} }\n'), '{ "a": {} }');
  assert.equal(extractDictBody('no braces'), null);
});

test('gdscriptDictToJSON handles comments, bare keys and trailing commas', () => {
  const gd = `{
    # intro line
    "1": { speaker: "K", text: "hi", choices: [ { text: "ok", next: "2", }, ], },
  }`;
  assert.deepEqual(JSON.parse(gdscriptDictToJSON(gd)), {
    1: { speaker: 'K', text: 'hi', choices: [{ text: 'ok', next: '2' }] }
  });
});

test('parseFlowGraph fills defaults and computes nextId', () => {
  const { nodes, nextId } = parseFlowGraph('{"7": {"text": "x", "secret": {"condition": "weight_above", "value": 3}}, "end": {}}');
  assert.equal(nextId, 8);
  assert.equal(nodes['7'].secret.value, '3');
  assert.deepEqual(nodes.end.choices, []);
  assert.equal(nodes.end.speaker, '');
  assert.throws(() => parseFlowGraph('{ not json'));
});

test('share codes round-trip unicode text', () => {
  const data = { nodes: { 1: { text: 'ไม่เป็นไร… 😴 "quotes"' } }, nextId: 2 };
  assert.deepEqual(decodeShareCode(encodeShareCode(data)), data);
  assert.throws(() => decodeShareCode('%%%'));
});

test('evaluateSecretCondition', () => {
  const flags = new Set(['honest']);
  assert.equal(evaluateSecretCondition({ condition: 'weight_above', value: '10' }, 11, flags), true);
  assert.equal(evaluateSecretCondition({ condition: 'weight_above', value: '10' }, 10, flags), false);
  assert.equal(evaluateSecretCondition({ condition: 'weight_below', value: '1' }, -15, flags), true);
  assert.equal(evaluateSecretCondition({ condition: 'flag_true', flag: ' honest ' }, 0, flags), true);
  assert.equal(evaluateSecretCondition({ condition: 'flag_false', flag: 'honest' }, 0, flags), false);
  assert.equal(evaluateSecretCondition({ condition: '' }, 0, flags), false);
  assert.equal(evaluateSecretCondition(null, 0, flags), false);
});

test('nodeMatchesQuery searches text, flags and choices', () => {
  const n = { ...createNode('intro', 0, 0), speaker: 'Friend', choices: [{ text: 'Run', set_flag: 'fled', next: '', type: 'neutral' }] };
  assert.equal(nodeMatchesQuery(n, 'friend'), true);
  assert.equal(nodeMatchesQuery(n, 'intro'), true);
  assert.equal(nodeMatchesQuery(n, 'fled'), true);
  assert.equal(nodeMatchesQuery(n, 'nope'), false);
});

test('analyzeGraph: example story has only expected dead ends', () => {
  const ex = exampleGraph();
  const issues = analyzeGraph({ nodes: ex.nodes, connections: buildConnections(ex.nodes) });
  assert.deepEqual(titles(issues), [
    'info:8:Story End / Dead End',
    'info:secret_1:Story End / Dead End'
  ]);
});

test('analyzeGraph reports broken targets, flags and orphans', () => {
  const g = graphOf({
    1: { next: 'ghost', choices: [] },
    2: { secret: { condition: 'flag_true', value: '', flag: 'never_set', next: '' } },
    3: { secret: { condition: 'flag_false', value: '', flag: '', next: '' }, next: '1' },
  }, []);
  assert.deepEqual(titles(analyzeGraph(g)), [
    'error:1:Broken Next Target',
    'error:3:Missing Secret Flag Name',
    'info:2:Story End / Dead End',
    'warning:2:Orphan Node (Unreachable)',
    'warning:2:Unset Flag Checked ("never_set")',
    'warning:3:Orphan Node (Unreachable)',
  ]);
  assert.deepEqual(analyzeGraph({ nodes: {}, connections: [] }), []);
});
