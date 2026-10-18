// ================================
// VOICE DATA (voice.html)
// ================================
// Story files -> the lines the voice tool shows. Works on the game's file
// format (flow_graph.json / th.json), not the editor's nodes.
import { plainText } from './graph.js';

// [{ id, speaker, en, th }] for every node with text, in story order.
// Notice markup {shown|Flag} is spoken as just the shown words.
export function voiceLines(graph, th) {
  return Object.entries(graph)
    .filter(([, n]) => n && n.text)
    .map(([id, n]) => ({
      id,
      speaker: n.speaker || '',
      en: plainText(n.text),
      th: plainText(th && th[id] && th[id].text),
    }));
}

// The voice file for a line: Assets/audio/voice/<Route>/<this name>.
export function fileName(id, lang) {
  return id + (lang === 'th' ? '_th' : '') + '.mp3';
}

export function speakersOf(lines) {
  return [...new Set(lines.map(l => l.speaker))];
}
