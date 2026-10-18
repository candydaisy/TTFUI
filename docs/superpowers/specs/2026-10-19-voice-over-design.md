# Voice-over tool: design

Date: 2026-10-19 · Status: approved in chat, awaiting spec review

## Goal

A teacher asked for voice acting in Untitled Illness. The writer voices **selected
lines** (not every line) with AI voices from **fish.audio**, each line in
**English, Thai, or both**. Voices are picked from the fish.audio library by
pasting a model ID per character.

Success: from one page, the writer casts characters, picks lines, generates a
take, listens, keeps or redoes it, and the kept file plays in the game in the
matching language with no manual copying or registering.

## Constraints (verified)

- fish.audio blocks browser calls: the CORS preflight to
  `https://api.fish.audio/v1/tts` returns `404 no route`. A static page cannot
  call it, and the API key must not reach the browser or any repo.
- API: `POST /v1/tts`, `Authorization: Bearer <key>`, optional `model` header
  (default `s2.1-pro`), JSON body `{text, reference_id, format, language, ...}`,
  streamed audio response; errors are JSON with `status` and `message`
  (401, 402, 503).
- Godot 4.7 imports mp3 natively. The game picks text language with
  `TranslationServer.get_locale()` and loads `<locale>.json` beside each
  `flow_graph.json`.
- The editor keeps its own autosaved story copy, so the voice tool must not
  write into `flow_graph.json` (an editor export would undo it).

## Files and data

**Audio**, in the game repo, one folder per route:

```
Assets/audio/voice/<Route>/<nodeId>.mp3      English
Assets/audio/voice/<Route>/<nodeId>_th.mp3   Thai
```

- A line is voiced if and only if its file exists. No list to keep in sync.
- No current node ID ends in `_th` (checked), so English and Thai names cannot
  collide; the page's story diagnostics are not changed for this.
- New files are imported the next time the Godot editor opens; exported builds
  include them as usual.
- An explicit node `voice` key still overrides: `"voice": "kay_wake_3"` plays
  `Assets/audio/voice/kay_wake_3.mp3` (`kay_wake_3_th.mp3` in Thai).

**Casting**, `Story/voices.json` in the game repo (committed with the story):

```json
{ "model": "s2.1-pro", "voices": { "Kay": "<fish model id>", "": "<narrator id>" } }
```

One voice ID per speaker, used for both languages (S2 models are multilingual).
The empty-string key is the narrator.

**Text sent to fish.audio**: English uses the node's `text`; Thai uses that
node's `text` from `th.json`. `{shown|Flag}` becomes `shown`. Real Text
(Elysia) and cut-off thoughts (Ulyn) are not voiced. Format mp3, mono, 44.1 kHz.

Ticked lines on the page are a to-do list only and are not saved.

## Local helper: `.TTFUI/serve.js`

- Started with `npm start` in `.TTFUI`. Node built-ins only (Node 18+ for
  `fetch`), no dependencies. Prints `Open http://localhost:8000`.
- Key: `FISH_API_KEY` from the environment or `.TTFUI/.env`. A new
  `.TTFUI/.gitignore` lists `.env`. Without a key the helper still runs and
  `/api/project` reports `hasKey: false`.
- Game folder: `GAME_DIR` from the environment, else the parent folder if it
  contains `project.godot`. If neither, the voice API answers with an error the
  page shows.
- Listens on `127.0.0.1` only.

| Request | Behavior |
|---|---|
| `GET` any other path | static file from `.TTFUI` (same as GitHub Pages) |
| `GET /api/project` | `{hasKey, routes: [{name, graph, th, files: [..]}], voices}` where `graph`/`th` are the parsed `Story/<Route>/flow_graph.json` / `th.json` (th `null` if absent) and `files` lists existing mp3 names in that route's voice folder |
| `POST /api/tts` | body `{text, voice, language, model?}` → calls fish.audio with the key → returns `audio/mpeg`. Saves nothing. |
| `GET /api/voice/<Route>/<name>.mp3` | the saved file, for playback on the page (404 if missing) |
| `PUT /api/voice/<Route>/<name>.mp3` | body is mp3 bytes → writes the file, creating the folder |
| `DELETE /api/voice/<Route>/<name>.mp3` | removes the file |
| `PUT /api/voices` | body is the casting JSON → writes `Story/voices.json` (tab-indented) |

Safety:

- `<Route>` must be an existing folder under `Story/` that holds a
  `flow_graph.json`; `<name>` must match `^[A-Za-z0-9_-]+$` (node IDs, plus
  optional `_th`). Anything else is `400`. No path ever leaves
  `Assets/audio/voice/`.
- The key is only added to the outgoing fish.audio request and never echoed.
- fish.audio errors are returned as `{error: "<status>: <message>"}` with the
  same status code; network failures as `502`.

## Page: `.TTFUI/voice.html` + `js/voice.js`

Same look as the other pages (toolbar, `.dialog` classes, sidebar). The Flow
Graph and Relationships toolbars get a **Voice** link.

- **Toolbar**: `VOICE` · Flow Graph · Relationships | route select | filter
  (All / Not voiced / Voiced / Ticked) | search (speaker, text, node ID) |
  key status | **Generate ticked (n)** with an approximate character count.
- **Line list**, in route story order: tick box, node ID, speaker, text, and an EN and a TH slot. TH slot only when
  the node has Thai text. Slot states:
  - not voiced: **Gen**
  - new take (in page memory): **▶**, **Keep** (PUT), **Redo**, **✕**
  - voiced: **▶** (plays the saved file), **Redo**; the file is replaced only
    on Keep
  - speaker without a voice ID: "cast <speaker> first"
- **Batch**: Generate ticked runs one request at a time; each result becomes a
  new take. **Keep all new takes** saves every pending take.
- **Casting sidebar**: one row per speaker in the route (narrator shown as
  "Narrator"): voice ID input and **Try** (speaks a short sample line). Model
  select. Link to the fish.audio voice library. Changes PUT `/api/voices`.
- **Without the helper** (GitHub Pages or plain file): `/api/project` fails, the
  page shows a panel: "Run `npm start` in the TTFUI folder to use the voice
  tool", with a link to the README section.
- Errors from the helper show as toasts with the helper's message.

## Game change (game repo)

`Scripts/StoryEngine/story_audio.gd`:

- Remove the `VOICE` dictionary.
- `static func voice_path(entry, route, node_id, locale) -> String`: base is
  `res://Assets/audio/voice/` + (`entry.voice` if present, else
  `route/node_id`), plus `_th` when `locale` begins with `th`, plus `.mp3`.
- `apply_voice(entry, route, node_id)`: stop; play `load(path)` if
  `ResourceLoader.exists(path)`; otherwise stay silent with no warning.
- `has_voice(name)` checks `ResourceLoader.exists` of the English override path.

`Scripts/StoryEngine/story_player.gd`:

- Line 272 passes the route (`flow_graph_path.get_base_dir().get_file()`) and
  node name.
- The startup check (line 776) keeps warning for an explicit `voice` key whose
  file is missing.

## Testing

- **Game**: `Tests/test_voice.gd` (headless, picked up by `Tests/run_all.sh`)
  covers `voice_path`: English, Thai, explicit override in both languages.
- **Helper**: `.TTFUI/tests/serve.test.js` starts the helper on a free port
  against a temp game folder and a fake fish.audio server. Covers: static
  files, `/api/project` shape, tts forwarding (key in header, never in the
  response), save/delete, casting write, and rejection of `..`, bad
  extensions, unknown routes and bad names. No real credits used.
- **Text prep**: unit tests for `{shown|Flag}` stripping and Thai text lookup.
- **Page**: screenshots in headless Firefox against the helper with the fake
  fish backend.
- **One real call** with the writer's key at the end, by hand.

## Out of scope

Voicing choice buttons, speed/emotion controls, per-line voice overrides in the
page, a separate Thai voice per character, voice cloning, and voice playback in
the editor's playtest.
