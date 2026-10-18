// ================================
// VOICE IN THE BROWSER (no npm start)
// ================================
// Answers the same /api requests as serve.js, inside the page: files go
// through a game folder the person picks (File System Access, Chrome/Edge),
// speech goes through their relay (relay/worker.js) since fish.audio blocks
// web pages. The key comes from the page's settings, never from a file.
const NAME_RE = /^[A-Za-z0-9_-]+$/;
const DEFAULT_VOICES = { model: 's2.1-pro', voices: {} };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const isMissing = err => err.name === 'NotFoundError' || err.name === 'TypeMismatchError';

// game: directory handle of the game folder; settings(): { key, relay }
export function folderApi(game, settings, fetch_ = (...a) => fetch(...a)) {
  async function dir(names, create = false) {
    let d = game;
    for (const name of names) d = await d.getDirectoryHandle(name, { create });
    return d;
  }
  async function tryDir(names) {
    try { return await dir(names); } catch (err) { if (isMissing(err)) return null; throw err; }
  }
  async function readFile(d, name) {
    try { return await (await d.getFileHandle(name)).getFile(); } catch (err) { if (isMissing(err)) return null; throw err; }
  }
  async function readJSON(d, name, fallback) {
    const file = await readFile(d, name);
    return file ? JSON.parse(await file.text()) : fallback;
  }
  async function writeFile(d, name, data) {
    const w = await (await d.getFileHandle(name, { create: true })).createWritable();
    await w.write(data);
    await w.close();
  }
  async function names(d, keep) {
    const out = [];
    if (d) for await (const [name, h] of d.entries()) if (await keep(name, h)) out.push(name);
    return out.sort();
  }

  async function storyDir() {
    const story = await tryDir(['Story']);
    if (!story) throw new HttpError(500, 'Game folder not found: pick the game folder (the one with project.godot and Story/)');
    return story;
  }
  // Routes are Story/<Route>/ folders that hold a flow_graph.json.
  async function routeNames(story) {
    return names(story, async (name, h) => h.kind === 'directory' && Boolean(await readFile(await story.getDirectoryHandle(name), 'flow_graph.json')));
  }
  const voiceDir = route => ['Assets', 'audio', 'voice', route];

  // The only files the API may touch: <known route>/<name>.mp3
  async function voiceFile(route, file) {
    const m = /^(.+)\.mp3$/.exec(file);
    if (!m || !NAME_RE.test(m[1]) || !NAME_RE.test(route) || !(await routeNames(await storyDir())).includes(route)) {
      throw new HttpError(400, `Not a voice file: ${route}/${file}`);
    }
    return file;
  }

  async function project() {
    const story = await storyDir();
    const { key, relay } = settings();
    const routes = [];
    for (const name of await routeNames(story)) {
      const d = await story.getDirectoryHandle(name);
      routes.push({
        name,
        graph: await readJSON(d, 'flow_graph.json', {}),
        th: await readJSON(d, 'th.json', null),
        files: await names(await tryDir(voiceDir(name)), (f, h) => h.kind === 'file' && f.endsWith('.mp3')),
      });
    }
    return { hasKey: Boolean(key && relay), gameDir: game.name, routes, voices: await readJSON(story, 'voices.json', DEFAULT_VOICES) };
  }

  async function tts({ text, voice, language, model }) {
    const { key, relay } = settings();
    if (!key) throw new HttpError(400, 'No fish.audio key: paste it under Casting');
    if (!relay) throw new HttpError(400, 'No relay URL: paste it under Casting (README, "Voice-over on the website")');
    if (!text || !voice) throw new HttpError(400, 'Need text and a voice ID');
    let res;
    try {
      res = await fetch_(relay.replace(/\/+$/, '') + '/v1/tts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', model: model || DEFAULT_VOICES.model },
        body: JSON.stringify({ text, reference_id: voice, format: 'mp3', sample_rate: 44100, language }),
      });
    } catch (err) {
      throw new HttpError(502, `Could not reach the relay: ${err.message}`);
    }
    if (!res.ok) {
      let message = res.statusText;
      try { message = (await res.json()).message || message; } catch { /* not JSON */ }
      throw new HttpError(res.status, `${res.status}: ${message}`);
    }
    return res.blob();
  }

  async function handle(method, url, body) {
    // decode each segment on its own so an encoded "/" can't add a level
    const parts = url.split('?')[0].split('/').map(decodeURIComponent);
    const [, , what, route, file] = parts; // '', 'api', ...
    if (what === 'project' && method === 'GET') return json(200, await project());
    if (what === 'tts' && method === 'POST') return new Response(await tts(body), { headers: { 'Content-Type': 'audio/mpeg' } });
    if (what === 'voices' && method === 'PUT') {
      if (!body || typeof body.voices !== 'object') throw new HttpError(400, 'Casting needs a "voices" object');
      await writeFile(await storyDir(), 'voices.json', JSON.stringify(body, null, '\t') + '\n');
      return json(200, { ok: true });
    }
    if (what === 'voice' && parts.length === 5) {
      const name = await voiceFile(route, file);
      if (method === 'GET') {
        const d = await tryDir(voiceDir(route));
        const found = d && await readFile(d, name);
        if (!found) throw new HttpError(404, 'No voice file');
        return new Response(found, { headers: { 'Content-Type': 'audio/mpeg' } });
      }
      if (method === 'PUT') {
        await writeFile(await dir(voiceDir(route), true), name, body);
        return json(200, { ok: true });
      }
      if (method === 'DELETE') {
        const d = await tryDir(voiceDir(route));
        try { if (d) await d.removeEntry(name); } catch (err) { if (!isMissing(err)) throw err; }
        return json(200, { ok: true });
      }
    }
    throw new HttpError(404, 'Unknown API request');
  }

  return async (method, url, body) => {
    try {
      return await handle(method, url, body);
    } catch (err) {
      return json(err.status || 500, { error: err instanceof URIError ? 'Bad URL' : err.message });
    }
  };
}

function json(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
