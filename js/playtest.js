// ================================
// PLAYTEST / STORY PREVIEW
// ================================
import { state } from './state.js';
import { escapeHTML, showToast } from './utils.js';
import {
  getTarget, evaluateSecretCondition, findCharacter, getMode, meterNames, meterKey, startMeters,
  startNodeId, isChoiceLocked, lineFor, choiceTime, changeTone, timeoutChoiceIndex, visibleChoices, NOTICE_RE,
  translatedNode
} from './graph.js';
import { centerOnNode, clearHighlight } from './canvas.js';

let playtestState = newRun(null);
let timer = null; // { interval, end, total } while a timed choice is counting down
let lang = 'en'; // 'th' shows each node's translation

// The active node as the player sees it in the current language.
function shownNode() {
  const n = state.nodes[playtestState.activeNodeId];
  return n && lang === 'th' ? translatedNode(n) : n;
}

// Switches language in place, like the game's Settings: keeps the run and any running timer.
export function togglePlaytestLang(btn) {
  lang = lang === 'en' ? 'th' : 'en';
  btn.textContent = lang === 'en' ? 'EN' : 'ไทย';
  const n = shownNode();
  if (!n) return;
  renderText(n);
  if (n.choices && n.choices.length) renderChoices(n);
}

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
  // Clicking a {detail|Flag} notices it, like in the game.
  document.getElementById('pt-dialogue-text').addEventListener('click', e => {
    const el = e.target.closest('.pt-notice');
    if (!el || playtestState.flags.has(el.dataset.flag)) return;
    playtestState.flags.add(el.dataset.flag);
    el.classList.add('noticed');
    showToast(`Noticed (${el.dataset.flag})`);
    document.getElementById('pt-flags-val').textContent = Array.from(playtestState.flags).join(', ');
    const n = shownNode();
    if (n && n.choices && n.choices.length) renderChoices(n); // a choice may need it
  });
}

// Story text -> HTML, with {details|Flag} as clickable spans.
function renderLine(text) {
  text = String(text || '');
  let html = '', last = 0;
  for (const m of text.matchAll(NOTICE_RE)) {
    html += escapeHTML(text.slice(last, m.index));
    const noticed = playtestState.flags.has(m[2]);
    html += `<span class="pt-notice${noticed ? ' noticed' : ''}" data-flag="${escapeHTML(m[2])}" title="Click to notice (${escapeHTML(m[2])})">${escapeHTML(m[1])}</span>`;
    last = m.index + m[0].length;
  }
  return html + escapeHTML(text.slice(last));
}

// Choice buttons (or a ringing phone for "call" nodes). Choices whose
// "requires" flag isn't set are hidden, like in the game.
function renderChoices(n) {
  const container = document.getElementById('pt-choices-container');
  const header = n.minigame
    ? `<div class="pt-call">minigame · <strong>${escapeHTML(n.minigame.split('/').pop())}</strong> · pick how it ends</div>`
    : n.call ? `<div class="pt-call">incoming call · <strong>${escapeHTML(n.call)}</strong></div>` : '';
  container.innerHTML = header + visibleChoices(n.choices, playtestState.flags).map(({ c, i: idx }) => {
    const locked = !n.minigame && isChoiceLocked(state.mode, c, playtestState.meters);
    let metaHtml = locked ? `<span class="pt-badge-locked">locked</span>` : '';
    meterNames(state.mode).forEach(m => {
      const v = Number(c[meterKey(m)]) || 0;
      if (v) metaHtml += `<span class="${changeTone(state.mode, m, v) === 'good' ? 'pt-badge-pos' : 'pt-badge-neg'}">${v > 0 ? '+' : ''}${v} ${escapeHTML(m)}</span>`;
    });
    if (c.set_flag) metaHtml += `<span class="pt-badge-flag">+flag: ${escapeHTML(c.set_flag)}</span>`;
    if (c.requires) metaHtml += `<span class="pt-badge-flag">needs: ${escapeHTML(c.requires)}</span>`;
    if (c.result) metaHtml += `<span class="pt-badge-flag">result: ${escapeHTML(c.result)}</span>`;
    if (c.type && !n.minigame) metaHtml += `<span style="opacity:0.6;font-size:10px;">[${escapeHTML(c.type)}]</span>`;
    return `
      <button class="pt-choice-btn" data-choice-index="${idx}" ${locked ? 'disabled' : ''}>
        <span>${escapeHTML(c.text || '(Choice ' + (idx + 1) + ')')}</span>
        <div class="pt-choice-meta">${metaHtml}</div>
      </button>
    `;
  }).join('');
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

// Self-edit: the game types the real line, deletes it, then types the version.
function renderText(n) {
  const line = lineFor(state.mode, n, playtestState.meters);
  const textEl = document.getElementById('pt-dialogue-text');
  textEl.innerHTML = line.unsaid
    ? (line.cut
      ? `<span class="pt-unsaid" title="Cut off">${renderLine(line.unsaid)}</span><br>${renderLine(line.text || '...')}`
      : `<s class="pt-unsaid" title="Typed, then deleted">${renderLine(line.unsaid)}</s><br>${renderLine(line.text || '...')}`)
    : renderLine(line.text || '...');
  if (n.quiet) textEl.insertAdjacentHTML('beforeend', `<div class="pt-quiet">quiet line: slow, can't be skipped in the game</div>`);
}

function renderPlaytestStep() {
  stopTimer();
  const currId = playtestState.activeNodeId;
  const n = shownNode();
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

  renderText(n);

  // Actions: Choices vs Continue
  const choicesContainer = document.getElementById('pt-choices-container');
  const advanceContainer = document.getElementById('pt-advance-container');

  if (n.choices && n.choices.length > 0) {
    choicesContainer.style.display = 'flex';
    advanceContainer.style.display = 'none';

    renderChoices(n);
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

// Timed choices and ringing calls count down like in the game; running out
// picks the mode's timeout choice ("perform" for Elysia, "neutral" for Ulyn).
function startTimer(n) {
  const seconds = n.minigame ? 0 : choiceTime(state.mode, n, playtestState.meters); // a minigame keeps its own time
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
      const shown = visibleChoices(n.choices, playtestState.flags);
      const pick = timeoutChoiceIndex(state.mode, shown.map(x => x.c), playtestState.meters);
      if (pick >= 0) {
        showToast(n.call ? 'It rang out' : 'Time ran out');
        selectPlaytestChoice(shown[pick].i);
      }
    }
  }, 50);
}

function selectPlaytestChoice(idx) {
  const currId = playtestState.activeNodeId;
  const n = state.nodes[currId];
  if (!n || !n.choices || !n.choices[idx]) return;

  const choice = n.choices[idx];
  if (!n.minigame && isChoiceLocked(state.mode, choice, playtestState.meters)) return;
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
