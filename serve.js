// ================================
// LOCAL HELPER (npm start)
// ================================
// Serves the tool on localhost and backs the voice page: reads the game's
// Story folder, sends text to fish.audio with the key from .env (the browser
// can't: fish.audio blocks web pages, and the key must stay off the page),
// and saves voice files to Assets/audio/voice/<Route>/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
};
const NAME_RE = /^[A-Za-z0-9_-]+$/;
const MAX_BODY = 20 * 1024 * 1024;
const DEFAULT_VOICES = { model: 's2.1-pro', voices: {} };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createServer({ root, gameDir, apiKey, fishUrl = 'https://api.fish.audio' }) {
  root = path.resolve(root);

  // Everything that reads or writes one game folder.
  function forGame(gameDir) {
    function storyDir() {
      if (!gameDir || !fs.existsSync(path.join(gameDir, 'Story'))) {
        throw new HttpError(500, `Game folder not found${gameDir ? ` (${gameDir} has no Story folder)` : ''}: paste its path on the Voice page, set GAME_DIR, or keep TTFUI inside the game folder`);
      }
      return path.join(gameDir, 'Story');
    }

    // Routes are Story/<Route>/ folders that hold a flow_graph.json.
    function routeNames() {
      const dir = storyDir();
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'flow_graph.json')))
        .map(d => d.name).sort();
    }

    const voiceDir = route => path.join(gameDir, 'Assets', 'audio', 'voice', route);

    // The only files the API may touch: <known route>/<name>.mp3
    function voicePath(route, file) {
      const m = /^(.+)\.mp3$/.exec(file);
      if (!m || !NAME_RE.test(m[1]) || !NAME_RE.test(route) || !routeNames().includes(route)) {
        throw new HttpError(400, `Not a voice file: ${route}/${file}`);
      }
      return path.join(voiceDir(route), file);
    }

    function readJSON(file, fallback) {
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
    }

    function project() {
      const dir = storyDir();
      return {
        hasKey: Boolean(apiKey),
        gameDir,
        routes: routeNames().map(name => {
          const vdir = voiceDir(name);
          return {
            name,
            graph: readJSON(path.join(dir, name, 'flow_graph.json'), {}),
            th: readJSON(path.join(dir, name, 'th.json'), null),
            files: fs.existsSync(vdir) ? fs.readdirSync(vdir).filter(f => f.endsWith('.mp3')).sort() : [],
          };
        }),
        voices: readJSON(path.join(dir, 'voices.json'), DEFAULT_VOICES),
      };
    }

    async function tts(body) {
      if (!apiKey) throw new HttpError(400, 'No FISH_API_KEY: put FISH_API_KEY=... in .TTFUI/.env and restart');
      const { text, voice, language, model } = body;
      if (!text || !voice) throw new HttpError(400, 'Need text and a voice ID');
      let res;
      try {
        res = await fetch(fishUrl + '/v1/tts', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', model: model || DEFAULT_VOICES.model },
          body: JSON.stringify({ text, reference_id: voice, format: 'mp3', sample_rate: 44100, language }),
        });
      } catch (err) {
        throw new HttpError(502, `Could not reach fish.audio: ${err.message}`);
      }
      if (!res.ok) {
        let message = res.statusText;
        try { message = (await res.json()).message || message; } catch { /* not JSON */ }
        throw new HttpError(res.status, `${res.status}: ${message}`);
      }
      return Buffer.from(await res.arrayBuffer());
    }

    async function api(req, res, parts) {
      const [, , what, route, file] = parts; // '', 'api', ...
      if (what === 'project' && req.method === 'GET') return sendJSON(res, 200, project());
      if (what === 'tts' && req.method === 'POST') return send(res, 200, 'audio/mpeg', await tts(await jsonBody(req)));
      if (what === 'voices' && req.method === 'PUT') {
        const casting = await jsonBody(req);
        if (!casting || typeof casting.voices !== 'object') throw new HttpError(400, 'Casting needs a "voices" object');
        fs.writeFileSync(path.join(storyDir(), 'voices.json'), JSON.stringify(casting, null, '\t') + '\n');
        return sendJSON(res, 200, { ok: true });
      }
      if (what === 'voice' && parts.length === 5) {
        const file_ = voicePath(route, file);
        if (req.method === 'GET') {
          if (!fs.existsSync(file_)) throw new HttpError(404, 'No voice file');
          return send(res, 200, 'audio/mpeg', fs.readFileSync(file_));
        }
        if (req.method === 'PUT') {
          const body = await readBody(req);
          fs.mkdirSync(path.dirname(file_), { recursive: true });
          fs.writeFileSync(file_, body);
          return sendJSON(res, 200, { ok: true });
        }
        if (req.method === 'DELETE') {
          fs.rmSync(file_, { force: true });
          return sendJSON(res, 200, { ok: true });
        }
      }
      throw new HttpError(404, 'Unknown API request');
    }

    return api;
  }

  // The page may name the game folder (X-Game-Dir, URI-encoded so any name fits
  // in a header); otherwise the one the helper found at start.
  function gameFor(req) {
    const raw = req.headers['x-game-dir'];
    if (!raw) return gameDir;
    const dir = decodeURIComponent(raw);
    if (!path.isAbsolute(dir)) throw new HttpError(400, `Game folder must be a full path, like /home/you/UntitledIllness: ${dir}`);
    return dir;
  }

  function serveStatic(res, urlPath) {
    const rel = urlPath === '/' ? '/index.html' : urlPath;
    const file = path.resolve(root, '.' + rel);
    // nothing outside the tool, and no hidden files (.env holds the API key)
    if (!file.startsWith(root + path.sep) || path.relative(root, file).split(path.sep).some(p => p.startsWith('.'))
        || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
    }
    send(res, 200, TYPES[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
  }

  return http.createServer(async (req, res) => {
    try {
      // a page on another site that re-points its own name at 127.0.0.1 (DNS
      // rebinding) still sends its own Host, so only local names get through
      const host = (req.headers.host || '').replace(/:\d+$/, '');
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new HttpError(403, 'Only localhost may use the helper');
      const rawPath = req.url.split('?')[0];
      // decode each segment on its own so an encoded "/" can't add a level
      const parts = rawPath.split('/').map(decodeURIComponent);
      if (parts[1] === 'api') await forGame(gameFor(req))(req, res, parts);
      else serveStatic(res, parts.join('/'));
    } catch (err) {
      if (err instanceof HttpError) sendJSON(res, err.status, { error: err.message });
      else if (err instanceof URIError) sendJSON(res, 400, { error: 'Bad URL' });
      else { console.error(err); sendJSON(res, 500, { error: err.message }); }
    }
  });
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendJSON(res, status, data) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(data));
}

// Requiring a JSON content type makes browsers ask before sending a request
// from another site (a plain text/plain POST would go through and spend credits).
async function jsonBody(req) {
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Send JSON (Content-Type: application/json)');
  const buf = await readBody(req);
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Request body is not valid JSON'); }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// KEY=VALUE lines into process.env (values already set in the shell win).
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  loadEnv(path.join(root, '.env'));
  const parent = path.dirname(root);
  const gameDir = process.env.GAME_DIR || (fs.existsSync(path.join(parent, 'project.godot')) ? parent : '');
  const port = Number(process.env.PORT) || 8000;
  createServer({ root, gameDir, apiKey: process.env.FISH_API_KEY || '' }).listen(port, '127.0.0.1', () => {
    console.log(`Open http://localhost:${port}/voice.html`);
    console.log(gameDir ? `Game folder: ${gameDir}` : 'Game folder not found: paste its path on the Voice page, or set GAME_DIR=/path/to/game');
    if (!process.env.FISH_API_KEY) console.log('No FISH_API_KEY yet: add FISH_API_KEY=... to .TTFUI/.env and restart');
  });
}
