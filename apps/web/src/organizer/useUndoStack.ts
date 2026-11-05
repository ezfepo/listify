import { useCallback, useRef, useState } from 'react';

export interface UndoEntry {
  label: string;
  undo: () => Promise<void>;
}

/** What the UI may show of an undo entry: its label and when it was pushed. */
export interface HistoryItem {
  label: string;
  at: number;
}

interface StoredEntry extends UndoEntry {
  at: number;
}

const MAX_ENTRIES = 50;

export function useUndoStack() {
  const stackRef = useRef<StoredEntry[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const sync = useCallback(() => {
    setHistory(stackRef.current.map(({ label, at }) => ({ label, at })));
  }, []);

  const push = useCallback(
    (entry: UndoEntry) => {
      stackRef.current = [...stackRef.current, { ...entry, at: Date.now() }].slice(-MAX_ENTRIES);
      sync();
    },
    [sync],
  );

  const undo = useCallback(async () => {
    const stack = stackRef.current;
    const entry = stack[stack.length - 1];
    if (!entry) return;
    stackRef.current = stack.slice(0, -1);
    sync();
    await entry.undo();
  }, [sync]);

  const topLabel = history[history.length - 1]?.label ?? null;

  // `history` is oldest-first; the session-history column is the same store.
  return { push, undo, canUndo: topLabel !== null, topLabel, history };
}
