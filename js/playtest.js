// ================================
// PLAYTEST / STORY PREVIEW
// ================================
import { state } from './state.js';
import { escapeHTML, showToast } from './utils.js';
import {
  getTarget, evaluateSecretCondition, findCharacter, getMode, meterNames, meterKey, startMeters,
  startNodeId, isChoiceLocked, lineFor, choiceTime, changeTone
} from './graph.js';
import { centerOnNode, clearHighlight } from './canvas.js';

let playtestState = newRun(null);
let timer = null; // { interval, end, total } while a timed choice is counting down

function newRun(startId) {
  return { activeNodeId: startId, meters: startMeters(state.mode), flags: new Set(), history: [] };
}

function defaultStartId() {
  return startNodeId(state.nodes);
}

function stopTimer() {
  if (timer) clearInterval(timer.interval);
  timer = null;
}

function renderMeters(deltas = {}) {
  const mode = getMode(state.mode);
  document.getElementById('pt-meters').innerHTML = meterNames(state.mode).map(m => {
    const d = deltas[m];
    const delta = d ? `<span class="pt-delta ${changeTone(state.mode, m, d)}">(${d > 0 ? '+' : ''}${d})</span>` : '';
    return `<div class="pt-stat-pill" title="${escapeHTML(mode.meters[m].label)}"><span>${escapeHTML(mode.meters[m].label)}:</span><strong>${playtestState.meters[m]}</strong>${delta}</div>`;
  }).join('');
}

export function setupPlaytestEvents() {
  document.getElementById('pt-choices-container').addEventListener('click', e => {
    const btn = e.target.closest('.pt-choice-btn');
    if (btn) selectPlaytestChoice(Number(btn.dataset.choiceIndex));
  });
}

export function isPlaytestOpen() {
  const overlay = document.getElementById('playtest-overlay');
  return Boolean(overlay) && overlay.style.display === 'flex';
}

export function openPlaytest(startNodeId) {
  if (!Object.keys(state.nodes).length) {
    showToast('Add nodes before playtesting.');
    return;
  }

  let startId = startNodeId;
  if (!startId) {
    startId = (state.selectedNode && state.nodes[state.selectedNode]) ? state.selectedNode : defaultStartId();
  }

  playtestState = newRun(startId);
  document.getElementById('playtest-overlay').style.display = 'flex';
  renderPlaytestStep();
}

export function closePlaytest() {
  stopTimer();
  const overlay = document.getElementById('playtest-overlay');
  if (overlay) overlay.style.display = 'none';
  clearHighlight();
}

export function restartPlaytest() {
  stopTimer();
  playtestState = newRun(defaultStartId());
  renderPlaytestStep();
}

function goTo(nextTarget) {
  if (nextTarget && state.nodes[nextTarget]) {
    playtestState.activeNodeId = nextTarget;
    renderPlaytestStep();
  } else {
    renderPlaytestEnd();
  }
}

function renderPlaytestStep() {
  stopTimer();
  const currId = playtestState.activeNodeId;
  const n = state.nodes[currId];
  if (!n) {
    renderPlaytestEnd();
    return;
  }

  // Center and highlight node on canvas
  centerOnNode(currId);

  // Top Bar HUD
  document.getElementById('pt-node-badge').textContent = `Node ${n.id}`;
  if (!playtestState.justChose) renderMeters();
  playtestState.justChose = false;

  const flagsArr = Array.from(playtestState.flags);
  document.getElementById('pt-flags-val').textContent = flagsArr.length ? flagsArr.join(', ') : 'none';

  // Secret route preview banner
  const secretBanner = document.getElementById('pt-secret-banner');
  const secretWillTrigger = Boolean(n.secret && n.secret.condition && n.secret.next) &&
    evaluateSecretCondition(n.secret, playtestState.meters, playtestState.flags);
  if (secretWillTrigger) {
    secretBanner.style.display = 'flex';
    secretBanner.textContent = `Secret route condition met (${n.secret.condition})! Next step will divert to Node ${n.secret.next}.`;
  } else {
    secretBanner.style.display = 'none';
  }

  // Scene Tags
  function setSceneTag(tagId, valId, val) {
    const el = document.getElementById(tagId);
    if (val && val.trim()) {
      document.getElementById(valId).textContent = val.trim();
      el.style.display = 'inline-flex';
    } else {
      el.style.display = 'none';
    }
  }
  setSceneTag('pt-bg-tag', 'pt-bg-val', n.background);
  setSceneTag('pt-show-tag', 'pt-show-val', n.showChars);
  setSceneTag('pt-hide-tag', 'pt-hide-val', n.hideChars);
  setSceneTag('pt-sfx-tag', 'pt-sfx-val', n.sfx);
  setSceneTag('pt-amb-tag', 'pt-amb-val', n.amb);
  setSceneTag('pt-voice-tag', 'pt-voice-val', n.voice);

  // Dialogue Box
  const speakerNameEl = document.getElementById('pt-speaker-name');
  speakerNameEl.textContent = n.speaker ? n.speaker : '(Narrator)';
  const character = findCharacter(state.characters, n.speaker);
  speakerNameEl.style.color = character ? character.color : n.speaker ? 'var(--accent)' : 'var(--text-muted)';

  const emotionTag = document.getElementById('pt-emotion-tag');
  if (n.emotion) {
    emotionTag.textContent = n.emotion;
    emotionTag.style.display = 'inline-block';
  } else {
    emotionTag.style.display = 'none';
  }

  // Self-edit: the game types the real line, deletes it, then types the version.
  const line = lineFor(state.mode, n, playtestState.meters);
  const textEl = document.getElementById('pt-dialogue-text');
  textEl.innerHTML = line.unsaid
    ? `<s class="pt-unsaid" title="Typed, then deleted">${escapeHTML(line.unsaid)}</s><br>${escapeHTML(line.text || '...')}`
    : escapeHTML(line.text || '...');

  // Actions: Choices vs Continue
  const choicesContainer = document.getElementById('pt-choices-container');
  const advanceContainer = document.getElementById('pt-advance-container');

  if (n.choices && n.choices.length > 0) {
    choicesContainer.style.display = 'flex';
    advanceContainer.style.display = 'none';

    choicesContainer.innerHTML = n.choices.map((c, idx) => {
      const locked = isChoiceLocked(state.mode, c, playtestState.meters);
      let metaHtml = locked ? `<span class="pt-badge-locked">locked</span>` : '';
      meterNames(state.mode).forEach(m => {
        const v = Number(c[meterKey(m)]) || 0;
        if (v) metaHtml += `<span class="${changeTone(state.mode, m, v) === 'good' ? 'pt-badge-pos' : 'pt-badge-neg'}">${v > 0 ? '+' : ''}${v} ${escapeHTML(m)}</span>`;
      });
      if (c.set_flag) {
        metaHtml += `<span class="pt-badge-flag">+flag: ${escapeHTML(c.set_flag)}</span>`;
      }
      if (c.type) {
        metaHtml += `<span style="opacity:0.6;font-size:10px;">[${escapeHTML(c.type)}]</span>`;
      }

      return `
        <button class="pt-choice-btn" data-choice-index="${idx}" ${locked ? 'disabled' : ''}>
          <span>${escapeHTML(c.text || '(Choice ' + (idx + 1) + ')')}</span>
          <div class="pt-choice-meta">${metaHtml}</div>
        </button>
      `;
    }).join('');
    startTimer(n);
  } else {
    choicesContainer.style.display = 'none';
    advanceContainer.style.display = 'flex';

    const nextTarget = getTarget(state, currId, 'out');
    const nextBtn = document.getElementById('pt-next-btn');
    if (secretWillTrigger) {
      nextBtn.textContent = `Secret Route (Space)`;
      nextBtn.className = 'tb-btn warning';
    } else if (nextTarget && state.nodes[nextTarget]) {
      nextBtn.textContent = `Continue (Space)`;
      nextBtn.className = 'tb-btn success';
    } else {
      nextBtn.textContent = `End Flow`;
      nextBtn.className = 'tb-btn';
    }
  }
}

// Timed choices count down like in the game; running out picks the "perform"
// choice (or the first one that isn't locked).
function startTimer(n) {
  const seconds = choiceTime(state.mode, n, playtestState.meters);
  const bar = document.getElementById('pt-timer');
  bar.style.display = seconds ? 'block' : 'none';
  if (!seconds) return;
  const fill = bar.firstElementChild;
  timer = { end: Date.now() + seconds * 1000, total: seconds * 1000 };
  timer.interval = setInterval(() => {
    const left = timer.end - Date.now();
    fill.style.width = Math.max(0, left / timer.total * 100) + '%';
    if (left <= 0) {
      stopTimer();
      const open = n.choices.map((c, i) => ({ c, i })).filter(({ c }) => !isChoiceLocked(state.mode, c, playtestState.meters));
      const pick = open.find(({ c }) => c.type === 'perform') || open[0];
      if (pick) {
        showToast('Time ran out');
        selectPlaytestChoice(pick.i);
      }
    }
  }, 50);
}

function selectPlaytestChoice(idx) {
  const currId = playtestState.activeNodeId;
  const n = state.nodes[currId];
  if (!n || !n.choices || !n.choices[idx]) return;

  const choice = n.choices[idx];
  if (isChoiceLocked(state.mode, choice, playtestState.meters)) return;
  stopTimer();

  playtestState.history.push({
    nodeId: currId,
    meters: { ...playtestState.meters },
    flags: new Set(playtestState.flags)
  });

  const deltas = {};
  meterNames(state.mode).forEach(m => {
    const d = Number(choice[meterKey(m)]) || 0;
    if (d) {
      deltas[m] = d;
      playtestState.meters[m] = Math.min(100, Math.max(0, playtestState.meters[m] + d)); // the game clamps to 0-100
    }
  });
  renderMeters(deltas);
  playtestState.justChose = true;

  if (choice.set_flag && choice.set_flag.trim()) {
    playtestState.flags.add(choice.set_flag.trim());
  }

  goTo(getTarget(state, currId, `choice-${idx}`));
}

export function playtestNext() {
  const currId = playtestState.activeNodeId;
  const n = state.nodes[currId];
  if (!n) return;

  if (n.choices && n.choices.length > 0) return;

  if (n.secret && n.secret.condition && n.secret.next &&
      evaluateSecretCondition(n.secret, playtestState.meters, playtestState.flags) &&
      state.nodes[n.secret.next]) {
    goTo(n.secret.next);
    return;
  }

  goTo(getTarget(state, currId, 'out'));
}

function renderPlaytestEnd() {
  stopTimer();
  document.getElementById('pt-timer').style.display = 'none';
  document.getElementById('pt-choices-container').style.display = 'none';
  document.getElementById('pt-advance-container').style.display = 'none';

  document.getElementById('pt-secret-banner').style.display = 'none';
  document.getElementById('pt-speaker-name').textContent = 'Story Completed';
  document.getElementById('pt-emotion-tag').style.display = 'none';

  const flagsArr = Array.from(playtestState.flags);
  const flagsStr = flagsArr.length ? flagsArr.map(f => `<code style="background:var(--surface2);padding:2px 5px;border-radius:3px;color:var(--accent-light);">${escapeHTML(f)}</code>`).join(', ') : 'none';

  document.getElementById('pt-dialogue-text').innerHTML = `
    <div style="line-height:1.8;">
      You have reached the end of this story path.<br>
      <strong>Final meters:</strong> <span style="color:var(--accent);">${meterNames(state.mode).map(m => `${escapeHTML(getMode(state.mode).meters[m].label)} ${playtestState.meters[m]}`).join(' · ')}</span><br>
      <strong>Collected Story Flags:</strong> ${flagsStr}
    </div>
    <div style="margin-top:16px;">
      <button class="tb-btn success" data-action="restartPlaytest">Play Again</button>
      <button class="tb-btn" data-action="closePlaytest" style="margin-left:8px;">Exit Preview</button>
    </div>
  `;
}
