/** Splits an array into groups of at most `size` — used to respect Spotify's per-call item caps. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be positive');
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
