import {
  getTracksPendingEnrichment,
  replaceTrackTags,
  setEnrichmentStatus,
  upsertTrackFeatures,
} from '../db/enrichment.js';
import { lastfmProvider } from './lastfm.js';
import { normalizeTags } from './normalize-tags.js';
import { reccobeatsProvider } from './reccobeats.js';
import type { EnrichProvider } from './types.js';

const PROVIDERS: EnrichProvider[] = [reccobeatsProvider, lastfmProvider];
const CONCURRENCY = 2;
const POLITE_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let running = false;

async function processProvider(provider: EnrichProvider): Promise<void> {
  if (!provider.isConfigured()) return;

  const pending = getTracksPendingEnrichment(provider.name);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const track = pending[cursor++];
      if (!track) return;

      try {
        const result = await provider.enrich(track);
        if (!result) {
          setEnrichmentStatus(track.uri, provider.name, 'not_found');
        } else {
          if (result.features) upsertTrackFeatures(track.uri, provider.name, result.features);
          if (result.tags) replaceTrackTags(track.uri, provider.name, normalizeTags(result.tags));
          setEnrichmentStatus(track.uri, provider.name, 'ok');
        }
      } catch {
        setEnrichmentStatus(track.uri, provider.name, 'error');
      }

      await sleep(POLITE_DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

/** Runs every configured provider over its pending tracks. Never throws — caller is fire-and-forget. */
export async function runEnrichmentQueue(onError?: (err: unknown) => void): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const provider of PROVIDERS) {
      await processProvider(provider);
    }
  } catch (err) {
    onError?.(err);
  } finally {
    running = false;
  }
}

/** Fire-and-forget entry point for callers (e.g. after a pull) that must not block on it. */
export function triggerEnrichment(onError?: (err: unknown) => void): void {
  void runEnrichmentQueue(onError);
}

export function isEnrichmentRunning(): boolean {
  return running;
}
