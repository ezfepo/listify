import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useUndoStack } from './useUndoStack';

describe('useUndoStack', () => {
  it('starts empty: nothing to undo', () => {
    const { result } = renderHook(() => useUndoStack());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.topLabel).toBeNull();
  });

  it('exposes the label of the most recent entry', () => {
    const { result } = renderHook(() => useUndoStack());
    act(() => result.current.push({ label: 'first', undo: vi.fn() }));
    act(() => result.current.push({ label: 'second', undo: vi.fn() }));
    expect(result.current.canUndo).toBe(true);
    expect(result.current.topLabel).toBe('second');
  });

  it('undoes most-recent-first and updates the top label', async () => {
    const order: string[] = [];
    const { result } = renderHook(() => useUndoStack());
    act(() => {
      result.current.push({ label: 'a', undo: async () => void order.push('a') });
      result.current.push({ label: 'b', undo: async () => void order.push('b') });
    });

    await act(() => result.current.undo());
    expect(order).toEqual(['b']);
    expect(result.current.topLabel).toBe('a');

    await act(() => result.current.undo());
    expect(order).toEqual(['b', 'a']);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.topLabel).toBeNull();
  });

  it('undo on an empty stack does nothing', async () => {
    const { result } = renderHook(() => useUndoStack());
    await act(() => result.current.undo());
    expect(result.current.canUndo).toBe(false);
  });

  it('pops the entry before running it, so a failing undo is not retried', async () => {
    const undo = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useUndoStack());
    act(() => result.current.push({ label: 'x', undo }));

    // Swallow the rejection inside act so React still flushes the state update
    // that happened before the failing undo ran.
    let error: unknown;
    await act(async () => {
      await result.current.undo().catch((e: unknown) => (error = e));
    });
    expect(error).toEqual(new Error('boom'));
    expect(result.current.canUndo).toBe(false);

    await act(() => result.current.undo());
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('keeps only the 50 most recent entries', async () => {
    const undone: number[] = [];
    const { result } = renderHook(() => useUndoStack());
    act(() => {
      for (let i = 0; i < 60; i++) {
        result.current.push({ label: `#${i}`, undo: async () => void undone.push(i) });
      }
    });

    for (let i = 0; i < 60; i++) {
      await act(() => result.current.undo());
    }
    expect(undone).toHaveLength(50);
    expect(undone[0]).toBe(59);
    expect(undone[49]).toBe(10);
  });
});

describe('useUndoStack history', () => {
  it('exposes labels with timestamps, oldest first, and drops undone entries', async () => {
    const { result } = renderHook(() => useUndoStack());
    expect(result.current.history).toEqual([]);

    const before = Date.now();
    act(() => {
      result.current.push({ label: 'a', undo: async () => {} });
      result.current.push({ label: 'b', undo: async () => {} });
    });
    expect(result.current.history.map((h) => h.label)).toEqual(['a', 'b']);
    expect(result.current.history[0]!.at).toBeGreaterThanOrEqual(before);

    await act(() => result.current.undo());
    expect(result.current.history.map((h) => h.label)).toEqual(['a']);
  });
});
