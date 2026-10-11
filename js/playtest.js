// ================================
// PLAYTEST / STORY PREVIEW
// ================================
import { state } from './state.js';
import { escapeHTML, showToast } from './utils.js';
import { getTarget, evaluateSecretCondition } from './graph.js';
import { centerOnNode, clearHighlight } from './canvas.js';

let playtestState = newRun(null);

function newRun(startId) {
  return { activeNodeId: startId, weight: 0, flags: new Set(), history: [] };
}

function defaultStartId() {
  return state.nodes["1"] ? "1" : Object.keys(state.nodes)[0];
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
  const overlay = document.getElementById('playtest-overlay');
  if (overlay) overlay.style.display = 'none';
  clearHighlight();
}

export function restartPlaytest() {
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
  document.getElementById('pt-weight-val').textContent = playtestState.weight;

  const flagsArr = Array.from(playtestState.flags);
  document.getElementById('pt-flags-val').textContent = flagsArr.length ? flagsArr.join(', ') : 'none';

  // Secret route preview banner
  const secretBanner = document.getElementById('pt-secret-banner');
  const secretWillTrigger = Boolean(n.secret && n.secret.condition && n.secret.next) &&
    evaluateSecretCondition(n.secret, playtestState.weight, playtestState.flags);
  if (secretWillTrigger) {
    secretBanner.style.display = 'flex';
    secretBanner.textContent = `⚡ Secret route condition met (${n.secret.condition})! Next step will divert to Node ${n.secret.next}.`;
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

  // Dialogue Box
  const speakerNameEl = document.getElementById('pt-speaker-name');
  speakerNameEl.textContent = n.speaker ? n.speaker : '(Narrator)';
  speakerNameEl.style.color = n.speaker ? 'var(--accent)' : 'var(--text-muted)';

  const emotionTag = document.getElementById('pt-emotion-tag');
  if (n.emotion) {
    emotionTag.textContent = n.emotion;
    emotionTag.style.display = 'inline-block';
  } else {
    emotionTag.style.display = 'none';
  }

  document.getElementById('pt-dialogue-text').textContent = n.text || '...';

  // Actions: Choices vs Continue
  const choicesContainer = document.getElementById('pt-choices-container');
  const advanceContainer = document.getElementById('pt-advance-container');

  if (n.choices && n.choices.length > 0) {
    choicesContainer.style.display = 'flex';
    advanceContainer.style.display = 'none';

    choicesContainer.innerHTML = n.choices.map((c, idx) => {
      let metaHtml = '';
      if (c.weight_change) {
        const wc = Number(c.weight_change);
        const cls = wc > 0 ? 'pt-badge-pos' : 'pt-badge-neg';
        const sign = wc > 0 ? '+' : '';
        metaHtml += `<span class="${cls}">${sign}${wc} weight</span>`;
      }
      if (c.set_flag) {
        metaHtml += `<span class="pt-badge-flag">+flag: ${escapeHTML(c.set_flag)}</span>`;
      }
      if (c.type) {
        metaHtml += `<span style="opacity:0.6;font-size:10px;">[${escapeHTML(c.type)}]</span>`;
      }

      return `
        <button class="pt-choice-btn" data-choice-index="${idx}">
          <span>${escapeHTML(c.text || '(Choice ' + (idx + 1) + ')')}</span>
          <div class="pt-choice-meta">${metaHtml}</div>
        </button>
      `;
    }).join('');
  } else {
    choicesContainer.style.display = 'none';
    advanceContainer.style.display = 'flex';

    const nextTarget = getTarget(state, currId, 'out');
    const nextBtn = document.getElementById('pt-next-btn');
    if (secretWillTrigger) {
      nextBtn.textContent = `Secret Route ▶ (Space)`;
      nextBtn.className = 'tb-btn warning';
    } else if (nextTarget && state.nodes[nextTarget]) {
      nextBtn.textContent = `Continue ▶ (Space)`;
      nextBtn.className = 'tb-btn success';
    } else {
      nextBtn.textContent = `End Flow ★`;
      nextBtn.className = 'tb-btn';
    }
  }
}

function selectPlaytestChoice(idx) {
  const currId = playtestState.activeNodeId;
  const n = state.nodes[currId];
  if (!n || !n.choices || !n.choices[idx]) return;

  const choice = n.choices[idx];

  playtestState.history.push({
    nodeId: currId,
    weight: playtestState.weight,
    flags: new Set(playtestState.flags)
  });

  if (choice.weight_change) {
    const delta = Number(choice.weight_change);
    playtestState.weight += delta;
    flashWeightDelta(delta);
  }

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
      evaluateSecretCondition(n.secret, playtestState.weight, playtestState.flags) &&
      state.nodes[n.secret.next]) {
    goTo(n.secret.next);
    return;
  }

  goTo(getTarget(state, currId, 'out'));
}

function flashWeightDelta(delta) {
  const el = document.getElementById('pt-weight-delta');
  if (!el) return;
  const sign = delta > 0 ? '+' : '';
  el.textContent = `(${sign}${delta})`;
  el.style.color = delta > 0 ? 'var(--success)' : 'var(--danger)';
  el.style.display = 'inline';
  setTimeout(() => { el.style.display = 'none'; }, 1500);
}

function renderPlaytestEnd() {
  document.getElementById('pt-choices-container').style.display = 'none';
  document.getElementById('pt-advance-container').style.display = 'none';

  document.getElementById('pt-secret-banner').style.display = 'none';
  document.getElementById('pt-speaker-name').textContent = '★ Story Completed';
  document.getElementById('pt-emotion-tag').style.display = 'none';

  const flagsArr = Array.from(playtestState.flags);
  const flagsStr = flagsArr.length ? flagsArr.map(f => `<code style="background:var(--surface2);padding:2px 5px;border-radius:3px;color:var(--accent-light);">${escapeHTML(f)}</code>`).join(', ') : 'none';

  document.getElementById('pt-dialogue-text').innerHTML = `
    <div style="line-height:1.8;">
      You have reached the end of this story path.<br>
      <strong>Final Weight:</strong> <span style="color:var(--accent);">${playtestState.weight}</span><br>
      <strong>Collected Story Flags:</strong> ${flagsStr}
    </div>
    <div style="margin-top:16px;">
      <button class="tb-btn success" data-action="restartPlaytest">↺ Play Again</button>
      <button class="tb-btn" data-action="closePlaytest" style="margin-left:8px;">Exit Preview</button>
    </div>
  `;
}
