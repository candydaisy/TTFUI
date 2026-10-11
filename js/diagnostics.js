// ================================
// STORY DIAGNOSTICS & LINTER (UI - the analysis itself lives in graph.js)
// ================================
import { state } from './state.js';
import { escapeHTML } from './utils.js';
import { analyzeGraph } from './graph.js';
import { centerOnNode } from './canvas.js';

let diagIssues = [];
let diagCurrentFilter = 'all';

export function setupDiagnosticsEvents() {
  document.getElementById('diag-list').addEventListener('click', e => {
    const issue = e.target.closest('.diag-issue');
    if (issue) diagJumpToNode(issue.dataset.nodeId);
  });
}

export function runDiagnostics() {
  diagIssues = analyzeGraph(state);
  updateDiagButton();
  renderDiagList();
}

function countOf(type) {
  return diagIssues.filter(i => i.type === type).length;
}

function updateDiagButton() {
  const btn = document.getElementById('diag-btn');
  if (!btn) return;
  const errors = countOf('error');
  const warnings = countOf('warning');

  if (errors > 0) {
    btn.textContent = `🛑 ${errors} Error${errors > 1 ? 's' : ''}`;
    btn.style.color = 'var(--danger)';
  } else if (warnings > 0) {
    btn.textContent = `⚠ ${warnings} Issue${warnings > 1 ? 's' : ''}`;
    btn.style.color = 'var(--warning)';
  } else {
    btn.textContent = `✔ Graph Valid`;
    btn.style.color = 'var(--success)';
  }
}

export function isDiagnosticsOpen() {
  const overlay = document.getElementById('diag-overlay');
  return Boolean(overlay) && overlay.style.display === 'flex';
}

export function toggleDiagnostics() {
  if (isDiagnosticsOpen()) {
    closeDiagnostics();
  } else {
    runDiagnostics();
    document.getElementById('diag-overlay').style.display = 'flex';
  }
}

export function closeDiagnostics() {
  const overlay = document.getElementById('diag-overlay');
  if (overlay) overlay.style.display = 'none';
}

export function filterDiag(type) {
  diagCurrentFilter = type;
  document.querySelectorAll('.diag-filter').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById(`diag-btn-${type}`);
  if (activeBtn) activeBtn.classList.add('active');
  renderDiagList();
}

function renderDiagList() {
  const list = document.getElementById('diag-list');
  if (!list) return;

  const total = diagIssues.length;
  const counts = {
    'diag-all-cnt': total,
    'diag-err-cnt': countOf('error'),
    'diag-warn-cnt': countOf('warning'),
    'diag-info-cnt': countOf('info'),
  };
  Object.entries(counts).forEach(([id, n]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = n;
  });
  const badgeSum = document.getElementById('diag-badge-summary');
  if (badgeSum) badgeSum.textContent = `${total} Issue${total === 1 ? '' : 's'}`;

  const filtered = diagCurrentFilter === 'all' ? diagIssues : diagIssues.filter(i => i.type === diagCurrentFilter);

  if (!filtered.length) {
    list.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-dim);font-size:13px;">
      ${total === 0 ? '🎉 All good! No issues detected in the graph.' : 'No issues found in this category.'}
    </div>`;
    return;
  }

  list.innerHTML = filtered.map(issue => {
    const icon = issue.type === 'error' ? '🛑' : (issue.type === 'warning' ? '⚠' : 'ℹ');
    return `
      <div class="diag-issue ${issue.type}" data-node-id="${escapeHTML(issue.nodeId)}">
        <div class="diag-issue-content">
          <div class="diag-issue-title"><span>${icon}</span> ${escapeHTML(issue.title)}</div>
          <div class="diag-issue-desc">${escapeHTML(issue.desc)}</div>
        </div>
        <div class="diag-node-tag">Node ${escapeHTML(issue.nodeId)} ↗</div>
      </div>
    `;
  }).join('');
}

function diagJumpToNode(id) {
  closeDiagnostics();
  centerOnNode(id);
}
