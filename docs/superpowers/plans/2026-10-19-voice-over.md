# Voice-over Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Voice page plus a local helper that generates fish.audio voice lines for selected story nodes (EN/TH) and saves them where the game plays them.

**Architecture:** `serve.js` (Node built-ins) serves the TTFUI folder and exposes a small `/api` that reads the game's `Story/`, proxies TTS to fish.audio with the key from `.env`, and writes mp3s under `Assets/audio/voice/<Route>/`. `voice.html` + `js/voice.js` is the UI; pure helpers live in `js/voice-data.js`. The game loads voice files by path instead of a hand-written list.

**Tech Stack:** Node ≥18 built-ins (`http`, `fs`, `fetch`), `node:test`, vanilla ES modules, GDScript (Godot 4.7).

**Spec:** `docs/superpowers/specs/2026-10-19-voice-over-design.md`

## Global Constraints

- No npm dependencies. `npm start` = `node serve.js`, port `8000` (env `PORT` overrides), host `127.0.0.1`.
- Key: `FISH_API_KEY` from env or `.TTFUI/.env`; never sent to the page. `.env` git-ignored.
- Game folder: env `GAME_DIR`, else parent folder if it has `project.godot`.
- Files: `Assets/audio/voice/<Route>/<nodeId>.mp3` (EN), `<nodeId>_th.mp3` (TH); explicit node `voice` key overrides in the game only.
- Names match `^[A-Za-z0-9_-]+$`; route must be a `Story/<Route>/` folder with `flow_graph.json`.
- Casting file `Story/voices.json`: `{ "model": "s2.1-pro", "voices": { "<speaker>": "<id>" } }`, `""` = narrator, tab-indented.
- fish request: `POST <fish>/v1/tts`, headers `Authorization: Bearer <key>`, `Content-Type: application/json`, `model: <model>`; body `{ text, reference_id, format: "mp3", sample_rate: 44100, language }`.
- Text sent: EN = `plainText(node.text)`, TH = `plainText(th[id].text)`; nodes with empty text are not listed.

## Review Focus

- Helper started outside the game repo (no `GAME_DIR`, no `../project.godot`): page shows the helper's error, nothing crashes.
- fish.audio returns 401/402/503 or the network is down: the page shows `"<status>: <message>"`, the take slot returns to its previous state.
- A route without `th.json`: no TH slots, `/api/project` gives `th: null`.
- Keep pressed twice / Redo on a voiced line: the saved file is only replaced on Keep, never deleted by Redo.
- A request body that is not valid JSON on `PUT /api/voices` / `POST /api/tts`: `400`, no file written.

---

### Task 1: Pure voice data helpers

**Files:**
- Create: `js/voice-data.js`
- Test: `tests/voice-data.test.js`

**Interfaces:**
- Produces: `voiceLines(graph: object, th: object|null) -> [{ id, speaker, en, th }]` (story key order, `th` is `''` when missing, empty-`text` nodes skipped, text via `plainText` from `graph.js`); `fileName(id: string, lang: 'en'|'th') -> string` (`'12'`/`'12_th'` + `.mp3`); `speakersOf(lines) -> string[]` (unique, first-seen order, `''` included if a narrator line exists).

- [ ] **Step 1: Write failing tests** — `voiceLines` on `{a:{speaker:'K',text:'Hi {there|F}.'}, b:{text:''}, c:{text:'Yo'}}` with th `{a:{text:'สวัสดี'}}` → `[{id:'a',speaker:'K',en:'Hi there.',th:'สวัสดี'},{id:'c',speaker:'',en:'Yo',th:''}]`; th `null` → all `th:''`; `fileName('12','th') === '12_th.mp3'`, `fileName('12','en') === '12.mp3'`; `speakersOf` of that result → `['K','']`.
- [ ] **Step 2:** `node --test tests/voice-data.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement the three exports.
- [ ] **Step 4:** Test passes; `npm test` all green.
- [ ] **Step 5:** Commit `Add voice line helpers`.

### Task 2: Local helper `serve.js`

**Files:**
- Create: `serve.js`, `.gitignore` (`.env`), `tests/serve.test.js`
- Modify: `package.json` (add `"start": "node serve.js"`)

**Interfaces:**
- Produces: `export function createServer({ root, gameDir, apiKey, fishUrl = 'https://api.fish.audio' }) -> http.Server` (not listening). Running `node serve.js` loads `.env`, resolves `gameDir`, listens on `127.0.0.1:PORT`, prints `Open http://localhost:<port>/voice.html`. Endpoints exactly as the spec table. JSON errors are `{ error: string }`.
- `GET /api/project` → `{ hasKey, gameDir, routes: [{ name, graph, th, files }], voices }` (`voices` defaults to `{ model: 's2.1-pro', voices: {} }`; `files` = mp3 names, sorted). No game dir → `500 {error:'Game folder not found: set GAME_DIR or keep TTFUI inside the game folder'}`.
- `GET /api/voice/<Route>/<name>.mp3` → saved file (`audio/mpeg`), 404 if missing, 400 on a bad name.
- `POST /api/tts` body `{ text, voice, language, model? }` → `audio/mpeg`; missing key → `400 {error:'No FISH_API_KEY: put FISH_API_KEY=... in .TTFUI/.env and restart'}`; fish non-200 → same status, `{error:'<status>: <message>'}`; fetch throws → `502`.

- [ ] **Step 1: Write failing tests** in `tests/serve.test.js`: before all, make a temp game dir (`project.godot`, `Story/Kay/flow_graph.json`, `Story/Kay/th.json`, `Story/Notes/readme.md`), start a fake fish `http` server that records the last request and replies `audio/mpeg` bytes `ID3fake` (or `402 {"status":402,"message":"no credits"}` when text is `broke`), and `createServer(...)` on port 0. Tests:
  - `GET /index.html` → 200, `GET /../package.json`-style traversal (`/%2e%2e/x`) → 404.
  - `/api/project`: `routes` names `['Kay']`, `th` parsed, `files` `[]`, `hasKey` true, response body does not contain the key.
  - `POST /api/tts {text:'Hi',voice:'v1',language:'en'}` → 200 bytes `ID3fake`; fake saw `authorization: Bearer test-key`, `model: s2.1-pro`, body `reference_id:'v1'`, `format:'mp3'`; response does not contain `test-key`.
  - `text:'broke'` → 402 `{error:'402: no credits'}`.
  - `PUT /api/voice/Kay/12_th.mp3` writes the bytes; then `/api/project` files `['12_th.mp3']`; `GET` returns the bytes; `DELETE` removes it; `GET` again → 404.
  - Rejected with 400 and nothing written: `/api/voice/Kay/..%2Fx.mp3`, `/api/voice/Kay/12.wav`, `/api/voice/Nope/12.mp3`, `/api/voice/Notes/12.mp3`, `/api/voice/Kay/a b.mp3`.
  - `PUT /api/voices` with `{model:'s1',voices:{K:'id'}}` writes tab-indented `Story/voices.json`; invalid JSON body → 400.
  - No key server: `POST /api/tts` → 400 with the `.env` message.
- [ ] **Step 2:** `node --test tests/serve.test.js` → FAIL.
- [ ] **Step 3:** Implement `serve.js`. Static: `decodeURIComponent` the path, `path.resolve(root, '.' + p)` must stay inside `root`, `/` → `index.html`, content types for html/js/css/json/mp3/png/svg. Bodies read fully into a Buffer (cap 20 MB → 413). `.env` parser: lines `KEY=VALUE`, `#` comments, only when run directly.
- [ ] **Step 4:** Tests pass; `npm test` green.
- [ ] **Step 5:** Commit `Add local helper for voice generation`.

### Task 3: Voice page

**Files:**
- Create: `voice.html`, `js/voice.js`
- Modify: `style.css` (voice list styles), `index.html` (File menu: `Voice` link after Relationships), `relations.html` (toolbar `Voice` link after Flow Graph), `README.md` (Voice section: `npm start`, `.env`, workflow, game file layout)

**Interfaces:**
- Consumes: Task 1 exports; Task 2 endpoints; `escapeHTML`, `showToast` from `utils.js`.
- Page state: `project` (from `/api/project`), `route`, `ticked: Set<id>`, `takes: Map<'id|lang', { url: string, blob: Blob }>`, `busy: Set<'id|lang'>`.

- [ ] **Step 1:** `voice.html`: toolbar per spec (`VOICE` logo, Flow Graph / Relationships links, `#route-select`, `#filter-select` All/Not voiced/Voiced/Ticked, `#search-input`, `#key-status`, `#gen-ticked-btn` "Generate ticked (n · ~c chars)", `#keep-all-btn` hidden until takes exist); `#main` with `#voice-list` and `#sidebar` (Casting: one row per `speakersOf` speaker with `input[data-speaker]` + Try, `#model-select` with `s2.1-pro`, `s2-pro`, `s1`, `s2.1-pro-free`, link `https://fish.audio/discovery/`); `#no-helper` panel (`.dialog-msg`) with the spec copy.
- [ ] **Step 2:** `js/voice.js`: load project (fail → show `#no-helper`, hide main); render rows (`id`, speaker or `Narrator`, `en` text, EN slot, TH slot only if `th`), slots per spec states; `generate(id, lang)` → POST `/api/tts` → store take, `audio.play()` it; `keep` → PUT bytes, add to `files`, drop take; `discard` → revoke URL; a saved line plays from `GET /api/voice/<Route>/<name>.mp3`; casting input `change` → PUT `/api/voices` (debounced 400 ms); Try → POST tts with `"Hi, this is <Speaker or the narrator>."`; batch generates ticked missing-or-retake slots for both languages that have text, one at a time, updating the button text with progress.
- [ ] **Step 3:** Verify with headless Firefox screenshots against `serve.js` using a temp game dir copy and a fake fish (`fishUrl`), driving one generate → keep through dispatched clicks; and the no-helper panel by opening the page from a plain static server.
- [ ] **Step 4:** `npm test` green; commit `Add Voice page`.

### Task 4: Game plays voice files by path (game repo)

**Files:**
- Modify: `../Scripts/StoryEngine/story_audio.gd` (remove `VOICE`, add `voice_path`, change `apply_voice`, `has_voice`), `../Scripts/StoryEngine/story_player.gd:272` (pass route + node), `:776` unchanged behavior
- Create: `../Tests/test_voice.gd`

**Interfaces:**
- Produces: `static func voice_path(entry: Dictionary, route: String, node_id: String, locale: String) -> String`; `func apply_voice(entry: Dictionary, route: String, node_id: String) -> void`.

- [ ] **Step 1: Write failing test** `Tests/test_voice.gd` (SceneTree, prints PASS/FAIL like the others): `voice_path({}, "Kay", "12", "en")` → `res://Assets/audio/voice/Kay/12.mp3`; locale `th_TH` → `.../Kay/12_th.mp3`; `{"voice":"kay_wake_3"}` en → `res://Assets/audio/voice/kay_wake_3.mp3`, th → `.../kay_wake_3_th.mp3`.
- [ ] **Step 2:** `godot --headless --path .. -s res://Tests/test_voice.gd` → FAIL.
- [ ] **Step 3:** Implement; update the header comment and the voice comment block in `story_audio.gd` to describe the folder layout.
- [ ] **Step 4:** `sh ../Tests/run_all.sh` all PASS (or same results as before the change).
- [ ] **Step 5:** Commit in the game repo `Play voice lines by file path (TTFUI voice tool)`.

### Task 5: Whole-branch review

- [ ] Fresh reviewer reads the spec, this plan and the TTFUI + game diffs; fix confirmed findings; re-run both test suites.
