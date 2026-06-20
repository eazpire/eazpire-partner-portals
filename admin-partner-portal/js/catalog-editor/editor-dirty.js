/** Snapshot-based dirty tracking for catalog editor tabs. */

let snapshotJson = null;
let isDirtyFlag = false;
const listeners = new Set();

export function registerDirtyListener(fn) {
  listeners.add(fn);
  fn(isDirtyFlag);
  return () => listeners.delete(fn);
}

function notifyListeners(dirty) {
  for (const fn of listeners) fn(dirty);
}

export function setDirtySnapshot(state) {
  snapshotJson = JSON.stringify(state ?? null);
  isDirtyFlag = false;
  notifyListeners(false);
}

export function hasDirtySnapshot() {
  return snapshotJson != null;
}

export function isEditorDirty() {
  return isDirtyFlag;
}

export function checkDirty(currentState) {
  if (snapshotJson == null) return false;
  const dirty = snapshotJson !== JSON.stringify(currentState ?? null);
  if (dirty !== isDirtyFlag) {
    isDirtyFlag = dirty;
    notifyListeners(dirty);
  }
  return dirty;
}

export function markEditorDirty() {
  if (!isDirtyFlag) {
    isDirtyFlag = true;
    notifyListeners(true);
  }
}

export function clearDirtySnapshot() {
  snapshotJson = null;
  isDirtyFlag = false;
  notifyListeners(false);
}

export function resetDirtyAfterSave(state) {
  setDirtySnapshot(state);
}
