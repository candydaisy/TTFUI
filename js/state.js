// ================================
// SHARED EDITOR STATE
// ================================
// Every module reads and writes through this one object (ES module exports
// can't be reassigned from outside, but properties of an exported object can).
export const state = {
  nodes: {},
  connections: [], // {from, fromPort, to}
  selectedNode: null, // primary / last selected node
  selectedNodes: new Set(), // set of all selected node IDs
  pan: { x: 60, y: 60 },
  zoom: 1,
  nextId: 1,
  clipboard: null, // { nodes: [...], connections: [...] }
};

export function genId() {
  // find next available numeric id
  let id = String(state.nextId++);
  while (state.nodes[id]) id = String(state.nextId++);
  return id;
}

export function lastSelectedId() {
  return state.selectedNodes.size > 0 ? Array.from(state.selectedNodes)[state.selectedNodes.size - 1] : null;
}

export function hasSelection() {
  return state.selectedNodes.size > 0 || Boolean(state.selectedNode);
}

// Selected IDs, falling back to the primary selection.
export function selectedIds() {
  const ids = Array.from(state.selectedNodes);
  if (ids.length === 0 && state.selectedNode) ids.push(state.selectedNode);
  return ids;
}
