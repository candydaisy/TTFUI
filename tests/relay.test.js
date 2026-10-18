import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import relay from '../relay/worker.js';

const SITE = 'https://candydaisy.github.io';
let sent;

beforeEach(() => {
  sent = null;
  globalThis.fetch = async (url, init) => {
    sent = { url, init };
    return new Response('ID3fake', { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
  };
});

const ask = (method, path, headers = {}, body) => relay.fetch(new Request('https://relay.example' + path, { method, headers, body }));

test('answers the browser preflight from the site, allowing the key and model headers', async () => {
  const res = await ask('OPTIONS', '/v1/tts', { Origin: SITE, 'Access-Control-Request-Method': 'POST' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), SITE);
  assert.match(res.headers.get('access-control-allow-headers'), /authorization/);
  assert.match(res.headers.get('access-control-allow-headers'), /model/);
  assert.equal(sent, null);
});

test('forwards speech requests to fish.audio with the key and model, and hands back the mp3', async () => {
  const body = JSON.stringify({ text: 'Hi', reference_id: 'v1' });
  const res = await ask('POST', '/v1/tts', { Origin: SITE, Authorization: 'Bearer k', model: 's1', 'Content-Type': 'application/json' }, body);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ID3fake');
  assert.equal(res.headers.get('access-control-allow-origin'), SITE);
  assert.equal(sent.url, 'https://api.fish.audio/v1/tts');
  assert.equal(sent.init.headers.authorization, 'Bearer k');
  assert.equal(sent.init.headers.model, 's1');
  assert.equal(new TextDecoder().decode(sent.init.body), body);
});

test('passes fish.audio errors through so the page can show them', async () => {
  globalThis.fetch = async () => new Response('{"status":402,"message":"no credits"}', { status: 402, headers: { 'Content-Type': 'application/json' } });
  const res = await ask('POST', '/v1/tts', { Origin: SITE, Authorization: 'Bearer k' }, '{}');
  assert.equal(res.status, 402);
  assert.equal((await res.json()).message, 'no credits');
});

test('other websites and other paths get nothing', async () => {
  assert.equal((await ask('POST', '/v1/tts', { Origin: 'https://evil.example', Authorization: 'Bearer k' }, '{}')).status, 403);
  assert.equal((await ask('POST', '/v1/tts', { Authorization: 'Bearer k' }, '{}')).status, 403);
  assert.equal((await ask('POST', '/v1/wallet', { Origin: SITE }, '{}')).status, 404);
  assert.equal(sent, null);
});
