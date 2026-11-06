import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip, Kbd, ProgressBar } from './ui';

describe('ui building blocks', () => {
  it('Chip renders its content', () => {
    render(<Chip tone="accent">Chill</Chip>);
    expect(screen.getByText('Chill').className).toContain('text-accent');
  });

  it('Kbd renders a keyboard hint', () => {
    render(<Kbd>s</Kbd>);
    expect(screen.getByText('s').tagName).toBe('KBD');
  });

  it('ProgressBar exposes its value and clamps out-of-range input', () => {
    const { rerender } = render(<ProgressBar value={42} label="Organized" />);
    expect(
      screen.getByRole('progressbar', { name: 'Organized' }).getAttribute('aria-valuenow'),
    ).toBe('42');
    rerender(<ProgressBar value={140} label="Organized" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    rerender(<ProgressBar value={-5} label="Organized" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });
});
