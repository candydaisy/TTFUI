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
  - Auto-layout button to organize complex narrative graphs cleanly.
  - Multi-touch gestures (two-finger pan, pinch-to-zoom).

- **Rich Dialogue and Staging Controls**
  - **Speaker and Emotions:** Configure character names, emotional tags, and sprite expressions (e.g., `K:tired`).
  - **Scene and Audio Directing:** Set background scenery, character stage enter/exit cues, sound effects (`SFX`), and ambient loops (`Amb`).
  - **Story Flags and Weights:** Track narrative state using custom story flags and numeric story weights (e.g., sanity, relationship meters).

- **Branching and Secret Routes**
  - **Choice System:** Multiple player dialogue choices with customized reply types, weight changes, next node targets, and flag setters.
  - **Secret Conditions:** Conditional branching based on flag checks or weight thresholds (e.g., `weight_below`, `has_flag`) diverting the story to alternate routes.

- **Interactive Playtest Mode**
  - Test and experience your dialogue directly in the browser without launching a game engine.
  - Live HUD displaying real-time speaker names, emotion tags, weight changes, active flags, and scene staging cues.
  - Advance dialogue with `Space` or click interactive choice buttons.

- **Story Diagnostics and Linter**
  - Automated graph analysis highlighting missing target nodes, orphan dialogue, dead ends, or broken conditions.
  - Filter by Errors, Warnings, and Info with one-click navigation to problem nodes.

- **Import and Export (Game Engine Ready)**
  - Export clean `flow_graph` JSON data ready for integration with Godot or custom game engines.
  - Import existing `.json` files via drag-and-drop or file upload.
  - Built-in example story (`Load Example`) for quick demonstration.
  - Automatic persistence to browser LocalStorage so work is never lost.

---

## Controls and Shortcuts

| Action | Shortcut / Gesture |
|---|---|
| **Add Node** | Right-click canvas > *Add Node Here* or `+ Node` button |
| **Undo** | `Ctrl + Z` (or `↶ Undo` button) |
| **Redo** | `Ctrl + Y` / `Ctrl + Shift + Z` (or `↷ Redo` button) |
| **Box / Marquee Select** | Click & drag on canvas background |
| **Toggle Multi-Select** | `Shift + Click` on node |
| **Select All Nodes** | `Ctrl + A` |
| **Export / Save As** | `Ctrl + S` or `Export JSON ↗` button |
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
Since TTFUI is built using standard web technologies (vanilla HTML5, CSS3, and JavaScript), no build tools or package managers are required.

1. Clone the repository:
   ```bash
   git clone https://github.com/candydaisy/TTFUI.git
   cd TTFUI
   ```
2. Open `index.html` directly in any modern web browser:
   ```bash
   # On Linux
   xdg-open index.html

   # On macOS
   open index.html

   # On Windows
   start index.html
   ```
3. Or serve with any lightweight static server:
   ```bash
   python3 -m http.server 8000
   # Open http://localhost:8000
   ```

---

## JSON Data Structure

The exported `flow_graph` JSON represents narrative nodes structured as follows:

```json
{
  "1": {
    "speaker": "K",
    "emotion": "tired",
    "text": "i hate school mornings.",
    "background": "bedroom",
    "sfx": "alarm",
    "amb": "bedroom_ambience",
    "showChars": "K",
    "hideChars": "Friend",
    "expression": "K:tired",
    "choices": [
      {
        "text": "No. I'm exhausted.",
        "type": "honest",
        "weight_change": -15,
        "next": "2",
        "set_flag": "was_honest"
      }
    ],
    "secret": {
      "condition": "weight_below",
      "value": "1",
      "flag": "",
      "next": "secret_route_1"
    },
    "next": "3"
  }
}
```

---

## Project Structure

```
TTFUI/
├── index.html        # Main application layout, canvas layers, and modal UI
├── style.css         # Dark theme styling, graph node components, and HUD
├── script.js         # Graph state management, diagnostics, canvas rendering, playtest engine
├── LICENSE           # MIT License
└── README.md         # Documentation & guide
```

---

## License

This project is licensed under the [MIT License](LICENSE).
