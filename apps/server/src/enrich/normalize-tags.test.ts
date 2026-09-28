import { describe, expect, it } from 'vitest';
import { normalizeTags } from './normalize-tags.js';

describe('normalizeTags', () => {
  it('lowercases and trims tags', () => {
    expect(normalizeTags([{ tag: '  Sad  ', weight: 50 }])).toEqual([{ tag: 'sad', weight: 50 }]);
  });

  it('drops tags below the weight floor', () => {
    expect(normalizeTags([{ tag: 'obscure', weight: 5 }])).toEqual([]);
  });

  it('maps synonyms to their canonical tag', () => {
    expect(normalizeTags([{ tag: 'melancholy', weight: 80 }])).toEqual([
      { tag: 'sad', weight: 80 },
    ]);
    expect(normalizeTags([{ tag: 'road trip', weight: 60 }])).toEqual([
      { tag: 'driving', weight: 60 },
    ]);
  });

  it('merges duplicates landing on the same canonical tag, keeping the max weight', () => {
    const result = normalizeTags([
      { tag: 'sad', weight: 40 },
      { tag: 'melancholy', weight: 90 },
      { tag: 'melancholic', weight: 20 },
    ]);
    expect(result).toEqual([{ tag: 'sad', weight: 90 }]);
  });

  it('drops empty tags', () => {
    expect(normalizeTags([{ tag: '   ', weight: 50 }])).toEqual([]);
  });
});
