import type { TierAssignment } from '../types';

const MAX_HISTORY = 50;

interface HistoryState {
  assignments: TierAssignment[];
  label: string;
}

const past: HistoryState[] = [];
const future: HistoryState[] = [];
let listeners: Array<() => void> = [];

function notify() {
  for (const fn of listeners) fn();
}

export const undoManager = {
  /** Save current state before a change */
  push(assignments: TierAssignment[], label: string) {
    past.push({ assignments: [...assignments], label });
    if (past.length > MAX_HISTORY) past.shift();
    // New action clears redo stack
    future.length = 0;
    notify();
  },

  canUndo: () => past.length > 0,
  canRedo: () => future.length > 0,

  /** Returns the state to restore, or null */
  undo(currentAssignments: TierAssignment[]): TierAssignment[] | null {
    const prev = past.pop();
    if (!prev) return null;
    future.push({ assignments: [...currentAssignments], label: 'redo' });
    notify();
    return prev.assignments;
  },

  redo(currentAssignments: TierAssignment[]): TierAssignment[] | null {
    const next = future.pop();
    if (!next) return null;
    past.push({ assignments: [...currentAssignments], label: 'undo' });
    notify();
    return next.assignments;
  },

  subscribe(fn: () => void) {
    listeners.push(fn);
    return () => { listeners = listeners.filter((l) => l !== fn); };
  },

  getState: () => ({ undoCount: past.length, redoCount: future.length }),
};
