import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderApi } from '../js/voice-folder.js';

// An in-memory stand-in for a File System Access directory handle.
// Strings are files, plain objects are folders.
const missing = () => new DOMException('missing', 'NotFoundError');
function fakeDir(tree) {
  return {
    kind: 'directory',
    async getDirectoryHandle(name, { create } = {}) {
      if (name === '..' || name.includes('/')) throw new TypeError('bad name');
      if (!(name in tree)) { if (!create) throw missing(); tree[name] = {}; }
      if (typeof tree[name] === 'string') throw new DOMException('file', 'TypeMismatchError');
      return fakeDir(tree[name]);
    },
    async getFileHandle(name, { create } = {}) {
      if (name === '..' || name.includes('/')) throw new TypeError('bad name');
      if (!(name in tree)) { if (!create) throw missing(); tree[name] = ''; }
      if (typeof tree[name] !== 'string') throw new DOMException('folder', 'TypeMismatchError');
      return {
        kind: 'file',
        getFile: async () => new Blob([tree[name]]),
        createWritable: async () => {
          const parts = [];
          return { write: async d => { parts.push(d); }, close: async () => { tree[name] = await new Blob(parts).text(); } };
        },
      };
    },
    async removeEntry(name) { if (!(name in tree)) throw missing(); delete tree[name]; },
    async *entries() {
      for (const [name, val] of Object.entries(tree)) yield [name, { kind: typeof val === 'string' ? 'file' : 'directory' }];
    },
  };
}

function game() {
  return {
    'project.godot': '',
    Story: {
      Kay: { 'flow_graph.json': JSON.stringify({ '12': { speaker: 'K', text: 'Hi' } }), 'th.json': JSON.stringify({ '12': { text: 'สวัสดี' } }) },
      Notes: { 'readme.md': '' },
    },
  };
}

const settings = { key: 'k', relay: 'https://relay.example/' };
function setup(tree = game(), s = settings) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (JSON.parse(init.body).text === 'broke') return new Response('{"status":402,"message":"no credits"}', { status: 402 });
    return new Response('ID3fake', { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
  };
  return { tree, calls, api: folderApi(fakeDir(tree), () => s, fetch) };
}

test('project lists routes with their story, translation, voice files and casting', async () => {
  const { api } = setup();
  const res = await api('GET', '/api/project');
  assert.equal(res.status, 200);
  const project = await res.json();
  assert.equal(project.hasKey, true);
  assert.deepEqual(project.routes, [{ name: 'Kay', graph: { '12': { speaker: 'K', text: 'Hi' } }, th: { '12': { text: 'สวัสดี' } }, files: [] }]);
  assert.deepEqual(project.voices, { model: 's2.1-pro', voices: {} });
});

test('a folder without Story/ says which folder to pick', async () => {
  const res = await setup({ docs: {} }).api('GET', '/api/project');
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /project\.godot/);
});

test('speech goes to the relay with the key and model, and comes back as mp3', async () => {
  const { api, calls } = setup();
  const res = await api('POST', '/api/tts', { text: 'Hi', voice: 'v1', language: 'th', model: 's1' });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ID3fake');
  assert.equal(calls[0].url, 'https://relay.example/v1/tts');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
  assert.equal(calls[0].init.headers.model, 's1');
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: 'Hi', reference_id: 'v1', format: 'mp3', sample_rate: 44100, language: 'th' });
});

test('fish.audio errors come back as readable messages', async () => {
  const res = await setup().api('POST', '/api/tts', { text: 'broke', voice: 'v1', language: 'en' });
  assert.equal(res.status, 402);
  assert.deepEqual(await res.json(), { error: '402: no credits' });
});

test('without a key or relay, speech says where to paste them and sends nothing', async () => {
  for (const s of [{ key: '', relay: 'https://r' }, { key: 'k', relay: '' }]) {
    const { api, calls } = setup(game(), s);
    const res = await api('POST', '/api/tts', { text: 'Hi', voice: 'v1', language: 'en' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, s.key ? /relay/ : /key/);
    assert.equal(calls.length, 0);
    assert.equal((await (await api('GET', '/api/project')).json()).hasKey, false);
  }
});

test('voice files can be saved, listed, played and deleted', async () => {
  const { api, tree } = setup();
  assert.equal((await api('PUT', '/api/voice/Kay/12_th.mp3', new Blob(['ID3take']))).status, 200);
  assert.equal(tree.Assets.audio.voice.Kay['12_th.mp3'], 'ID3take');
  assert.deepEqual((await (await api('GET', '/api/project')).json()).routes[0].files, ['12_th.mp3']);
  assert.equal(await (await api('GET', '/api/voice/Kay/12_th.mp3')).text(), 'ID3take');
  assert.equal((await api('DELETE', '/api/voice/Kay/12_th.mp3')).status, 200);
  assert.ok(!('12_th.mp3' in tree.Assets.audio.voice.Kay));
  assert.equal((await api('GET', '/api/voice/Kay/12_th.mp3')).status, 404);
});

test('voice paths outside the rules are rejected and write nothing', async () => {
  const { api, tree } = setup();
  for (const bad of ['/api/voice/Kay/..%2Fx.mp3', '/api/voice/Kay/12.wav', '/api/voice/Nope/12.mp3',
    '/api/voice/Notes/12.mp3', '/api/voice/Kay/a%20b.mp3', '/api/voice/..%2FStory/12.mp3']) {
    assert.equal((await api('PUT', bad, new Blob(['x']))).status, 400, bad);
  }
  assert.ok(!('Assets' in tree));
});

test('casting is saved as tab-indented Story/voices.json', async () => {
  const { api, tree } = setup();
  const casting = { model: 's1', voices: { K: 'id' } };
  assert.equal((await api('PUT', '/api/voices', casting)).status, 200);
  assert.equal(tree.Story['voices.json'], JSON.stringify(casting, null, '\t') + '\n');
  assert.deepEqual((await (await api('GET', '/api/project')).json()).voices, casting);
});
