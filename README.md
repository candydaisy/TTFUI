# TTFUI - The Tool For Untitled Illness

[![GitHub Pages](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-blue?style=for-the-badge&logo=github)](https://candydaisy.github.io/TTFUI/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

An intuitive, browser-based visual flow graph editor and interactive narrative design tool for **Untitled Illness**. Design dialogue trees, branching choices, conditional routing, scene staging, and audio triggers with instant playtesting and game-ready JSON export.

**Live Demo:** [https://candydaisy.github.io/TTFUI/](https://candydaisy.github.io/TTFUI/)

---

## Features

- **Visual Node Graph Editor**
  - Interactive canvas with smooth panning, zooming, and grid snapping.
  - Port-based visual connections for sequential dialogue, branch choices, and secret conditional paths.
  - Dashed flag links show where the selected node's story flags are set and checked.
  - Auto-layout button to organize complex narrative graphs cleanly.
  - Minimap in the corner shows the whole graph (nodes in their character colors) and the current view; click or drag it to jump around. Toggle it with the Minimap button.
  - Multi-touch gestures (two-finger pan, pinch-to-zoom).

- **Rich Dialogue and Staging Controls**
  - **Speaker and Emotions:** Configure character names, emotional tags, and sprite expressions (e.g., `K:tired`).
  - **Scene and Audio Directing:** Set background scenery, character stage enter/exit cues, sound effects (`SFX`), and ambient loops (`Amb`).
  - **Story Flags and Weights:** Track narrative state using custom story flags and numeric story weights (e.g., sanity, relationship meters).

- **Character Presets**
  - Define your cast once with a name, a speaker color, and the emotions each character can use.
  - The Speaker field suggests character names, and the Emotion menu shows that character's emotions.
  - Renaming a character updates every line, stage cue, and expression that uses it.
  - Diagnostics flag speakers that aren't in the cast (typos like `Freind`) and emotions a character doesn't have.
  - **Detect from Story** builds presets from the speakers you've already written. Importing a file does this automatically.
  - Presets are saved with your project (auto-save and share links) but are not added to the exported JSON, so the game format is unchanged.

- **Character Modes (same as the game)**
  - Each character's story follows their mode from the game (`Scripts/StoryEngine/modes/` in Untitled Illness). Pick it in the toolbar; importing a story picks it automatically.
  - **Kay (KayMode):** one `weight` meter, `weight_change` on choices, helpful choices lock at 80+.
  - **Elysia (ElysiaMode):** hidden `mask` and `energy` meters, `mask_change` / `energy_change` on choices, a `perform` choice type, **Real Text** (self-edit) and **Timed** choices, and honest choices lock when energy < 20 or mask > 85.
  - **Ulyn (UlynMode):** hidden `busy` and `unsaid` meters, `busy_change` / `unsaid_change` on choices, an `open` choice type (honest about himself, locks above busy 80), **cut-off thoughts** (`cut` / `cut_after`) and **quiet** lines.
  - The sidebar, secret conditions (`mask_below`, `unsaid_above`, ...), node cards, diagnostics and playtest all follow the mode.

- **Calls and Noticing (any mode)**
  - **Call:** give a node a caller (`"call": "Mom"`) and its choices show up on a ringing phone. In Ulyn's mode it rings for 6 seconds, then declines.
  - **Noticing:** write `{shown text|FlagName}` in a line to make a detail the player can click. A choice with **requires** only shows up once that flag is set. Playtest lets you click details, just like the game.
  - New modes go in `MODES` in `js/graph.js`; keep it in sync with the mode's `INFO` in Godot.

- **Branching and Secret Routes**
  - **Choice System:** Multiple player dialogue choices with customized reply types, weight changes, next node targets, and flag setters.
  - **Secret Conditions:** Conditional branching based on flag checks or weight thresholds (e.g., `weight_below`, `has_flag`) diverting the story to alternate routes.

- **Interactive Playtest Mode**
  - Test and experience your dialogue directly in the browser without launching a game engine.
  - Live HUD displaying real-time speaker names, emotion tags, the mode's meters, active flags, and scene staging cues.
  - Plays by the game's rules: locked choices, self-edit lines (the deleted line is shown crossed out), and timed choices that pick the `perform` answer when time runs out.
  - Advance dialogue with `Space` or click interactive choice buttons.

- **Story Diagnostics and Linter**
  - Automated graph analysis highlighting missing target nodes, orphan dialogue, dead ends, or broken conditions.
  - Filter by Errors, Warnings, and Info with one-click navigation to problem nodes.

- **Relationship Web Editor** (`relations.html`, the **Relationships** button)
  - Edits `Story/relationships.json`, the file behind the game's relationship web (Gallery screen), with the same graph: playable characters in their color, everyone else grey.
  - Click a character to edit them and their links ("Ulyn is Kay's... best friend"). Shift+click another character to link them.
  - **Open Story Folder** loads `relationships.json` and checks every `<Route>/flow_graph.json` for speakers missing from the web.
  - Undo / redo, autosave, and export in the same layout as the file in the game repo.

- **Import and Export (Game Engine Ready)**
  - Export `flow_graph` JSON in the same layout as `Story/<Name>/flow_graph.json` (tabs, one choice per line), so an imported story exports back to the identical file and git diffs only show real changes.
  - Keys the editor doesn't know about are kept, so nothing is lost on export.
  - Import existing `.json` files via drag-and-drop or file upload.
  - Built-in example story (`Load Example`) for quick demonstration.
  - Automatic persistence to browser LocalStorage so work is never lost.

---

## Controls and Shortcuts

| Action | Shortcut / Gesture |
|---|---|
| **Add Node** | Right-click canvas > *Add Node Here* or `+ Node` button |
| **Undo** | `Ctrl + Z` (or Undo button) |
| **Redo** | `Ctrl + Y` / `Ctrl + Shift + Z` (or Redo button) |
| **Box / Marquee Select** | Click & drag on canvas background |
| **Toggle Multi-Select** | `Shift + Click` on node |
| **Select All Nodes** | `Ctrl + A` |
| **Export / Save As** | `Ctrl + S` or Export JSON button |
| **Search Nodes** | `Ctrl + F` (Search by speaker, dialogue, ID, flags) |
| **Playtest Story** | `P` key or Play button |
| **Advance Dialogue** | `Space` key in Playtest mode |
| **Copy Node(s)** | `Ctrl + C` |
| **Paste Node(s)** | `Ctrl + V` |
| **Duplicate Node(s)** | `Ctrl + D` |
| **Delete Node(s)** | `Delete` / `Backspace` |
| **Pan Canvas** | Alt + Left-click Drag or Middle-click Drag (or 2 fingers on touch) |
| **Zoom Canvas** | Mouse Wheel or Pinch-to-zoom |

---

## Getting Started

### Run in the Browser (No Installation)
Visit the deployed web application at:
[https://candydaisy.github.io/TTFUI/](https://candydaisy.github.io/TTFUI/)

### Run Locally
TTFUI is built with plain HTML, CSS, and JavaScript (ES modules), so there is no build step and nothing to install.

1. Clone the repository:
   ```bash
   git clone https://github.com/candydaisy/TTFUI.git
   cd TTFUI
   ```
2. Serve the folder with any static web server:
   ```bash
   python3 -m http.server 8000
   # Open http://localhost:8000
   ```
   Opening `index.html` directly from disk (`file://`) does not work, because browsers block ES modules loaded from local files.

### Run Tests
The graph logic (export/import round-trips, character modes, diagnostics, playtest rules, layout, share codes) and the relationship web logic have unit tests that run on Node.js 18+ with no dependencies:

```bash
npm test
```

---

## JSON Data Structure

The exported `flow_graph` JSON is the game's story format. The full reference is in the game repo's `CONTRIBUTING.md` ("Story file structure").

```json
{
	"start": {
		"speaker": "Kay",
		"emotion": "tired",
		"text": "Monday...",
		"next": "wake_2",
		"background": "Kay's room1",
		"show_characters": ["Kay"],
		"expression": {"Kay": "School"},
		"sfx": "Alarm",
		"amb": "Bedroom",
		"voice": "kay_wake_1"
	},

	"wake_2": {
		"speaker": "Kay",
		"text": "What should I do first?",
		"choices": [
			{"text": "Take a nap", "type": "neutral", "weight_change": 5, "next": "nap_1"},
			{"text": "Get up", "type": "honest", "weight_change": -5, "next": "up_1", "set_flag": "GotUp"}
		],
		"secret": {"condition": "weight_below", "value": 35, "next": "endA_1"}
	}
}
```

Elysia's stories use her mode's keys instead of `weight_change`:

```json
"mid_5": {
	"speaker": "Elysia",
	"text": "\"I know. Sorry.\"",
	"real_text": "\"I'm just tired, Mom.\"",
	"next": "mid_6"
},

"call_7": {
	"speaker": "Ploy",
	"text": "\"Right??\"",
	"timed": true,
	"choices": [
		{"text": "Stay on the call", "type": "perform", "mask_change": 5, "energy_change": -10, "next": "call_stay_1"}
	]
}
```

Ulyn's stories add cut-off thoughts, quiet lines, calls, and details to notice:

```json
"wake_5": {
	"speaker": "Ulyn",
	"text": "It's my favorite. She knows it's my favorite. That's why she says it.",
	"cut_after": "She knows it's my favorite.",
	"cut": "Anyway. Council at eight. Coffee first.",
	"choices": [
		{"text": "\"can't tmr. council stuff\"", "type": "neutral", "busy_change": 5, "unsaid_change": 5, "next": "wake_cant_1"}
	]
},

"seven_1": {
	"speaker": "",
	"text": "*At 7 p.m. the phone rings again. Mom.*",
	"call": "Mom",
	"choices": [
		{"text": "Decline", "type": "neutral", "busy_change": 5, "unsaid_change": 5, "next": "seven_decline_1"},
		{"text": "You were pressing your thumb.", "type": "honest", "busy_change": 0, "unsaid_change": -5, "next": "pres_thumb_1", "requires": "NoticedKayThumb"}
	]
}
```

Secret conditions are `flag_true` / `flag_false` (with `flag`) or `<meter>_above` / `<meter>_below` (with `value`) for the mode's meters.

---

## Project Structure

```
TTFUI/
├── index.html          # Flow graph editor: layout, canvas layers, and modal UI
├── relations.html      # Relationship web editor
├── style.css           # Dark theme styling, graph node components, and HUD
├── js/
│   ├── main.js         # Entry point: startup, data-action button wiring, keyboard shortcuts
│   ├── state.js        # Shared editor state (nodes, connections, selection, view)
│   ├── graph.js        # Pure graph logic: character modes, export/import, diagnostics, layout, share codes
│   ├── canvas.js       # Pan/zoom, mouse & touch interaction, node rendering, context menu
│   ├── nodes.js        # Node operations: add, delete, copy, paste, duplicate, layout
│   ├── sidebar.js      # Properties panel and choice editor
│   ├── characters.js   # Character presets window
│   ├── history.js      # Undo / redo
│   ├── search.js       # Ctrl+F node search
│   ├── minimap.js      # Graph overview and quick navigation
│   ├── diagnostics.js  # Story linter panel
│   ├── playtest.js     # In-browser story preview
│   ├── io.js           # Export, import, autosave, share links
│   ├── relations-data.js # Pure relationship web logic: read, check, edit, write, layout
│   ├── relations.js    # Relationship web editor UI
│   └── utils.js        # HTML escaping, toasts
├── tests/              # Unit tests (node --test)
├── package.json        # Only for `npm test`; no dependencies
├── LICENSE             # MIT License
└── README.md           # Documentation & guide
```

---

## License

This project is licensed under the [MIT License](LICENSE).
