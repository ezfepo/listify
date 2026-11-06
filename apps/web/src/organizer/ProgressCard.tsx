import type { StatusCounts } from '../lib/api';
import { Kbd, ProgressBar } from '../ui';

/** Share of the whole library that is organized (0 when the library is empty). */
export function organizedPercent(counts: StatusCounts): number {
  const total = counts.inbox + counts.organized + counts.skipped;
  return total === 0 ? 0 : Math.round((counts.organized / total) * 100);
}

export function ProgressCard({
  statusCounts,
  onTriageNext,
}: {
  statusCounts: StatusCounts;
  onTriageNext: () => void;
}) {
  const percent = organizedPercent(statusCounts);
  return (
    <section
      aria-label="Progress"
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-baseline gap-2">
          <span className="font-mono text-3xl font-medium tabular-nums">{percent}%</span>
          <span className="text-sm text-muted">organized</span>
        </div>
        <ProgressBar value={percent} label="Organized" />
        <dl className="mt-3 flex gap-6 text-sm">
          {(
            [
              ['Inbox', statusCounts.inbox],
              ['Archive', statusCounts.organized],
              ['Skipped', statusCounts.skipped],
            ] as const
          ).map(([label, count]) => (
            <div key={label}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="font-mono tabular-nums">{count}</dd>
            </div>
          ))}
        </dl>
      </div>
      <button
        onClick={onTriageNext}
        disabled={statusCounts.inbox === 0}
        className="rounded bg-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-40"
      >
        Triage the next song <Kbd>t</Kbd>
      </button>
    </section>
  );
}
