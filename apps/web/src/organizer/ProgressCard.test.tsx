import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { organizedPercent, ProgressCard } from './ProgressCard';

describe('organizedPercent', () => {
  it('is organized / (inbox + organized + skipped), rounded', () => {
    expect(organizedPercent({ inbox: 50, organized: 25, skipped: 25 })).toBe(25);
    expect(organizedPercent({ inbox: 1, organized: 2, skipped: 0 })).toBe(67);
  });

  it('is 0 for an empty library and 100 when everything is organized', () => {
    expect(organizedPercent({ inbox: 0, organized: 0, skipped: 0 })).toBe(0);
    expect(organizedPercent({ inbox: 0, organized: 9, skipped: 0 })).toBe(100);
  });
});

describe('ProgressCard', () => {
  it('shows the percentage, the three counts and a matching progress bar', () => {
    render(
      <ProgressCard
        statusCounts={{ inbox: 60, organized: 30, skipped: 10 }}
        onTriageNext={vi.fn()}
      />,
    );
    expect(screen.queryByText('30%')).not.toBeNull();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('30');
    expect(screen.getByText('Inbox').nextSibling?.textContent).toBe('60');
    expect(screen.getByText('Archive').nextSibling?.textContent).toBe('30');
    expect(screen.getByText('Skipped').nextSibling?.textContent).toBe('10');
  });

  it('starts triage from the button', async () => {
    const onTriageNext = vi.fn();
    render(
      <ProgressCard
        statusCounts={{ inbox: 3, organized: 0, skipped: 0 }}
        onTriageNext={onTriageNext}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Triage the next song/ }));
    expect(onTriageNext).toHaveBeenCalledTimes(1);
  });

  it('disables the button when the inbox is empty', () => {
    render(
      <ProgressCard statusCounts={{ inbox: 0, organized: 3, skipped: 0 }} onTriageNext={vi.fn()} />,
    );
    expect(
      (screen.getByRole('button', { name: /Triage the next song/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
