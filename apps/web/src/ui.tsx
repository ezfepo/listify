import type { ReactNode } from 'react';

type ChipTone = 'neutral' | 'accent' | 'done';

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: 'bg-raise text-ink',
  accent: 'bg-accent-soft text-accent',
  done: 'bg-done-soft text-done',
};

export function Chip({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: ChipTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${CHIP_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted">
      {children}
    </kbd>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className="h-2 w-full overflow-hidden rounded-full bg-raise"
    >
      <div className="h-full rounded-full bg-done" style={{ width: `${clamped}%` }} />
    </div>
  );
}
