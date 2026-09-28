import { useCallback, useRef, useState } from 'react';

export interface UndoEntry {
  label: string;
  undo: () => Promise<void>;
}

const MAX_ENTRIES = 50;

export function useUndoStack() {
  const stackRef = useRef<UndoEntry[]>([]);
  const [topLabel, setTopLabel] = useState<string | null>(null);

  const push = useCallback((entry: UndoEntry) => {
    stackRef.current = [...stackRef.current, entry].slice(-MAX_ENTRIES);
    setTopLabel(entry.label);
  }, []);

  const undo = useCallback(async () => {
    const stack = stackRef.current;
    const entry = stack[stack.length - 1];
    if (!entry) return;
    stackRef.current = stack.slice(0, -1);
    setTopLabel(stackRef.current[stackRef.current.length - 1]?.label ?? null);
    await entry.undo();
  }, []);

  return { push, undo, canUndo: topLabel !== null, topLabel };
}
