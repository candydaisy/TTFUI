import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../serve.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KEY = 'test-key';
let game, fish, app, noKey, lastFish;

const listen = server => new Promise(res => server.listen(0, '127.0.0.1', () => res(server.address().port)));

// Raw request so paths like /%2e%2e/ reach the server unnormalized.
function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, type: res.headers['content-type'] || '', buf, text: buf.toString() });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    req.end();
  });
}
const call = (method, urlPath, body) => request(app.address().port, method, urlPath, body);
const voiceFile = name => path.join(game, 'Assets/audio/voice/Kay', name);

before(async () => {
  game = fs.mkdtempSync(path.join(os.tmpdir(), 'ttfui-game-'));
  fs.writeFileSync(path.join(game, 'project.godot'), '');
  fs.mkdirSync(path.join(game, 'Story/Kay'), { recursive: true });
  fs.mkdirSync(path.join(game, 'Story/Notes'), { recursive: true });
  fs.writeFileSync(path.join(game, 'Story/Kay/flow_graph.json'), JSON.stringify({ '12': { speaker: 'K', text: 'Hi' } }));
  fs.writeFileSync(path.join(game, 'Story/Kay/th.json'), JSON.stringify({ '12': { text: 'สวัสดี' } }));
  fs.writeFileSync(path.join(game, 'Story/Notes/readme.md'), '');

  fish = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      lastFish = { url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) };
      if (lastFish.body.text === 'broke') {
        res.writeHead(402, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 402, message: 'no credits' }));
      } else {
        res.writeHead(200, { 'content-type': 'audio/mpeg' });
        res.end('ID3fake');
      }
    });
  });
  const fishUrl = `http://127.0.0.1:${await listen(fish)}`;
  app = createServer({ root: ROOT, gameDir: game, apiKey: KEY, fishUrl });
  noKey = createServer({ root: ROOT, gameDir: game, apiKey: '', fishUrl });
  await listen(app);
  await listen(noKey);
});

after(() => {
  fish.close(); app.close(); noKey.close();
  fs.rmSync(game, { recursive: true, force: true });
});

test('serves the tool files and refuses paths outside it', async () => {
  const page = await call('GET', '/index.html');
  assert.equal(page.status, 200);
  assert.match(page.type, /text\/html/);
  assert.equal((await call('GET', '/%2e%2e/%2e%2e/etc/passwd')).status, 404);
});

test('never serves hidden files such as .env (the API key) or .git', async () => {
  assert.equal((await call('GET', '/.git/config')).status, 404);
  assert.equal((await call('GET', '/.env')).status, 404);
  assert.equal((await call('GET', '/js/%2Eenv')).status, 404);
});

test('/api/project lists routes with their story, translation and voice files', async () => {
  const res = await call('GET', '/api/project');
  assert.equal(res.status, 200);
  const project = JSON.parse(res.text);
  assert.equal(project.hasKey, true);
  assert.deepEqual(project.routes.map(r => r.name), ['Kay']);
  assert.deepEqual(project.routes[0].th, { '12': { text: 'สวัสดี' } });
  assert.deepEqual(project.routes[0].files, []);
  assert.deepEqual(project.voices, { model: 's2.1-pro', voices: {} });
  assert.ok(!res.text.includes(KEY));
});

test('/api/tts forwards to fish.audio with the key and returns the mp3', async () => {
  const res = await call('POST', '/api/tts', { text: 'Hi', voice: 'v1', language: 'en' });
  assert.equal(res.status, 200);
  assert.match(res.type, /audio\/mpeg/);
  assert.equal(res.text, 'ID3fake');
  assert.equal(lastFish.url, '/v1/tts');
  assert.equal(lastFish.headers.authorization, `Bearer ${KEY}`);
  assert.equal(lastFish.headers.model, 's2.1-pro');
  assert.deepEqual(lastFish.body, { text: 'Hi', reference_id: 'v1', format: 'mp3', sample_rate: 44100, language: 'en' });
  assert.ok(!res.text.includes(KEY));
});

test('/api/tts passes on fish.audio errors as readable messages', async () => {
  const res = await call('POST', '/api/tts', { text: 'broke', voice: 'v1', language: 'en' });
  assert.equal(res.status, 402);
  assert.deepEqual(JSON.parse(res.text), { error: '402: no credits' });
});

test('/api/tts without a key explains where to put it', async () => {
  const res = await request(noKey.address().port, 'POST', '/api/tts', { text: 'Hi', voice: 'v1', language: 'en' });
  assert.equal(res.status, 400);
  assert.match(JSON.parse(res.text).error, /FISH_API_KEY=\.\.\. in \.TTFUI\/\.env/);
});

test('/api/tts rejects a body that is not JSON', async () => {
  assert.equal((await call('POST', '/api/tts', '{nope')).status, 400);
});

test('voice files can be saved, listed, played and deleted', async () => {
  assert.equal((await call('PUT', '/api/voice/Kay/12_th.mp3', Buffer.from('ID3take'))).status, 200);
  assert.equal(fs.readFileSync(voiceFile('12_th.mp3'), 'utf8'), 'ID3take');
  assert.deepEqual(JSON.parse((await call('GET', '/api/project')).text).routes[0].files, ['12_th.mp3']);
  const played = await call('GET', '/api/voice/Kay/12_th.mp3');
  assert.equal(played.status, 200);
  assert.equal(played.text, 'ID3take');
  assert.equal((await call('DELETE', '/api/voice/Kay/12_th.mp3')).status, 200);
  assert.ok(!fs.existsSync(voiceFile('12_th.mp3')));
  assert.equal((await call('GET', '/api/voice/Kay/12_th.mp3')).status, 404);
});

test('voice paths outside the rules are rejected and write nothing', async () => {
  for (const bad of ['/api/voice/Kay/..%2Fx.mp3', '/api/voice/Kay/12.wav', '/api/voice/Nope/12.mp3',
    '/api/voice/Notes/12.mp3', '/api/voice/Kay/a%20b.mp3', '/api/voice/..%2FStory/12.mp3']) {
    assert.equal((await call('PUT', bad, Buffer.from('x'))).status, 400, bad);
  }
  assert.ok(!fs.existsSync(path.join(game, 'Assets/audio/voice/x.mp3')));
  assert.ok(!fs.existsSync(path.join(game, 'Assets/audio/voice/Nope')));
});

test('/api/voices saves the casting as tab-indented Story/voices.json', async () => {
  const casting = { model: 's1', voices: { K: 'id' } };
  assert.equal((await call('PUT', '/api/voices', casting)).status, 200);
  assert.equal(fs.readFileSync(path.join(game, 'Story/voices.json'), 'utf8'), JSON.stringify(casting, null, '\t') + '\n');
  assert.deepEqual(JSON.parse((await call('GET', '/api/project')).text).voices, casting);
  assert.equal((await call('PUT', '/api/voices', '{nope')).status, 400);
});

test('without a game folder the API says how to fix it', async () => {
  const lost = createServer({ root: ROOT, gameDir: '', apiKey: KEY });
  await listen(lost);
  const res = await request(lost.address().port, 'GET', '/api/project');
  lost.close();
  assert.equal(res.status, 500);
  assert.match(JSON.parse(res.text).error, /Game folder not found/);
});
