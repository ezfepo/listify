import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UndoIndicatorDisplay, UndoIndicatorProvider, useUndoIndicator } from './UndoIndicator';

describe('UndoIndicator', () => {
  it('renders nothing while there is no label', () => {
    const { container } = render(
      <UndoIndicatorProvider>
        <UndoIndicatorDisplay />
      </UndoIndicatorProvider>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows the label and the undo hint once one is set', () => {
    function Harness() {
      const { setTopLabel } = useUndoIndicator();
      return <button onClick={() => setTopLabel('Assigned 3 tracks')}>set</button>;
    }
    render(
      <UndoIndicatorProvider>
        <Harness />
        <UndoIndicatorDisplay />
      </UndoIndicatorProvider>,
    );

    act(() => screen.getByRole('button', { name: 'set' }).click());
    expect(screen.queryByText(/Last action: Assigned 3 tracks/)).not.toBeNull();
    expect(screen.queryByText('(press u to undo)')).not.toBeNull();
  });

  it('throws a helpful error when used outside the provider', () => {
    expect(() => renderHook(() => useUndoIndicator())).toThrow(
      'useUndoIndicator must be used within UndoIndicatorProvider',
    );
  });
});
