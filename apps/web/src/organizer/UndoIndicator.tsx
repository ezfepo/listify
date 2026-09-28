import { createContext, useContext, useState, type ReactNode } from 'react';

interface UndoIndicatorContextValue {
  topLabel: string | null;
  setTopLabel: (label: string | null) => void;
}

const UndoIndicatorContext = createContext<UndoIndicatorContextValue | null>(null);

/**
 * Shares the undo stack's top label with the header (App.tsx), so it can render
 * in normal document flow instead of as a floating overlay — a fixed-position
 * toast kept colliding with whatever panel happened to be at that screen corner.
 */
export function UndoIndicatorProvider({ children }: { children: ReactNode }) {
  const [topLabel, setTopLabel] = useState<string | null>(null);
  return (
    <UndoIndicatorContext.Provider value={{ topLabel, setTopLabel }}>
      {children}
    </UndoIndicatorContext.Provider>
  );
}

export function useUndoIndicator(): UndoIndicatorContextValue {
  const ctx = useContext(UndoIndicatorContext);
  if (!ctx) throw new Error('useUndoIndicator must be used within UndoIndicatorProvider');
  return ctx;
}

export function UndoIndicatorDisplay() {
  const { topLabel } = useUndoIndicator();
  if (!topLabel) return null;
  return (
    <span className="text-xs text-zinc-400">
      Last action: {topLabel} <span className="text-zinc-500">(press u to undo)</span>
    </span>
  );
}
