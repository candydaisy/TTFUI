import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWeb, formatWeb, normalizeWeb, relationsOf, addCharacter, updateCharacter, renameCharacter,
  removeCharacter, addLink, updateLinkLabels, removeLink, checkWeb, storySpeakers, characterColor,
  layoutStep, initialPositions, OTHER_COLOR
} from '../js/relations-data.js';

// Same layout as Story/relationships.json in the game repo.
const WEB = `{
	"about": "Test web.",

	"ignore_speakers": ["", "???"],

	"characters": [
		{"id": "Kay", "name": "Kay", "playable": true, "color": "#5980ff", "picture": "", "about": "Carries everything."},

		{"id": "KayMom", "name": "Kay's Mom", "speaker": "Mom", "route": "Kay", "picture": "", "about": "Tired."},
		{"id": "Mint", "name": "Mint", "picture": "", "about": "Blunt."}
	],

	"links": [
		{"from": "Kay", "to": "KayMom", "to_is": "mom", "from_is": "son"},
		{"from": "Kay", "to": "Mint", "to_is": "girlfriend's best friend", "from_is": "best friend's boyfriend"}
	]
}
`;

test('parse -> format gives back the same file', () => {
  assert.equal(formatWeb(parseWeb(WEB)), WEB);
});

test('relationsOf reads both directions of a link', () => {
  const web = parseWeb(WEB);
  assert.deepEqual(relationsOf(web, 'Kay'), { KayMom: 'mom', Mint: "girlfriend's best friend" });
  assert.deepEqual(relationsOf(web, 'KayMom'), { Kay: 'son' });
});

test('editing returns new webs and keeps ids consistent', () => {
  const web = parseWeb(WEB);
  const { web: added, id } = addCharacter(web, { name: 'Ms. Noi' });
  assert.equal(id, 'MsNoi');
  assert.equal(web.characters.length, 3, 'input is not changed');

  const linked = addLink(added, 'Kay', 'MsNoi', 'teacher', 'student');
  assert.equal(addLink(linked, 'MsNoi', 'Kay'), linked, 'no duplicate links');
  assert.deepEqual(relationsOf(linked, 'MsNoi'), { Kay: 'student' });

  const relabeled = updateLinkLabels(linked, 'MsNoi', 'Kay', { otherIs: 'student (garden)', selfIs: 'garden advisor' });
  assert.deepEqual(relationsOf(relabeled, 'Kay').MsNoi, 'garden advisor');
  assert.deepEqual(relationsOf(relabeled, 'MsNoi').Kay, 'student (garden)');

  const renamed = renameCharacter(relabeled, 'Kay', 'K');
  assert.ok(renamed.links.every(l => l.from !== 'Kay' && l.to !== 'Kay'));
  assert.equal(renameCharacter(relabeled, 'Kay', 'Mint'), null, 'taken ids are refused');

  const removed = removeCharacter(renamed, 'K');
  assert.equal(removed.links.length, 0);
  assert.equal(removeLink(linked, 'MsNoi', 'Kay').links.length, 2);
});

test('updateCharacter drops emptied optional keys', () => {
  const web = updateCharacter(parseWeb(WEB), 'KayMom', { speaker: '', route: '' });
  const mom = web.characters.find(c => c.id === 'KayMom');
  assert.equal('speaker' in mom, false);
  assert.equal('route' in mom, false);
});

test('checkWeb finds broken data and speakers missing from the stories', () => {
  const web = parseWeb(WEB);
  assert.deepEqual(checkWeb(web), []);

  const stories = [
    { route: 'Kay', speakers: ['', 'Kay', 'Mom', 'Mint'] },
    { route: 'Elysia', speakers: ['Mom', '???'] }, // Kay's Mom only counts in Kay's story
  ];
  const texts = checkWeb(web, stories).map(i => i.text);
  assert.equal(texts.length, 1);
  assert.match(texts[0], /"Mom" speaks in Elysia's story/);

  const broken = normalizeWeb({ characters: [{ id: 'A', playable: true }, { id: 'A' }], links: [{ from: 'A', to: 'B' }] });
  const issues = checkWeb(broken).map(i => i.text).join('\n');
  assert.match(issues, /Two characters use the id "A"/);
  assert.match(issues, /playable but has no color/);
  assert.match(issues, /doesn't exist/);
  assert.match(issues, /missing a label/);
});

test('storySpeakers lists each speaker once', () => {
  assert.deepEqual(storySpeakers({ a: { speaker: 'Kay' }, b: { speaker: 'Kay' }, c: { speaker: '' } }), ['Kay', '']);
});

test('characterColor: playable color, everyone else grey', () => {
  assert.equal(characterColor({ playable: true, color: '#f22e3d' }), '#f22e3d');
  assert.equal(characterColor({ playable: true, color: 'red' }), OTHER_COLOR);
  assert.equal(characterColor({ color: '#f22e3d' }), OTHER_COLOR);
});

test('layout pulls linked characters together and settles', () => {
  const web = parseWeb(WEB);
  const nodes = initialPositions(web);
  let moved = Infinity;
  for (let i = 0; i < 2000 && moved > 0.01; i++) moved = layoutStep(web, nodes);
  assert.ok(moved <= 0.01, 'settles');
  const dist = (a, b) => Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
  assert.ok(dist('Kay', 'Mint') < 400);
});
