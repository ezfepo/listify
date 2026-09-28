import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, FEATURE_KEYS, type FeatureKey, type FeatureRanges } from '../lib/api';

interface RecipeEditorProps {
  playlistId: number;
  playlistName: string;
  onClose: () => void;
}

const FEATURE_BOUNDS: Record<FeatureKey, [number, number]> = {
  valence: [0, 1],
  energy: [0, 1],
  danceability: [0, 1],
  acousticness: [0, 1],
  instrumentalness: [0, 1],
  speechiness: [0, 1],
  tempo: [0, 220],
  loudness: [-60, 0],
};

function TagChips({
  tags,
  onChange,
  colorClass,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  colorClass: string;
}) {
  const [input, setInput] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${colorClass}`}
        >
          {tag}
          <button
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            className="opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && input.trim()) {
            e.preventDefault();
            const tag = input.trim().toLowerCase();
            if (!tags.includes(tag)) onChange([...tags, tag]);
            setInput('');
          }
        }}
        placeholder="add tag…"
        className="w-24 rounded bg-zinc-900 px-2 py-0.5 text-xs"
      />
    </div>
  );
}

export function RecipeEditor({ playlistId, playlistName, onClose }: RecipeEditorProps) {
  const queryClient = useQueryClient();
  const { data: recipe } = useQuery({
    queryKey: ['recipe', playlistId],
    queryFn: () => api.getRecipe(playlistId),
  });

  const [includeTags, setIncludeTags] = useState<string[]>([]);
  const [excludeTags, setExcludeTags] = useState<string[]>([]);
  const [featureRanges, setFeatureRanges] = useState<FeatureRanges>({});

  useEffect(() => {
    if (recipe) {
      setIncludeTags(recipe.includeTags);
      setExcludeTags(recipe.excludeTags);
      setFeatureRanges(recipe.featureRanges);
    }
  }, [recipe]);

  const save = useMutation({
    mutationFn: () => api.putRecipe(playlistId, { includeTags, excludeTags, featureRanges }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipe', playlistId] });
      onClose();
    },
  });

  function toggleFeature(key: FeatureKey, enabled: boolean) {
    setFeatureRanges((prev) => {
      const next = { ...prev };
      if (enabled) next[key] = FEATURE_BOUNDS[key];
      else delete next[key];
      return next;
    });
  }

  function setRange(key: FeatureKey, index: 0 | 1, value: number) {
    setFeatureRanges((prev) => {
      const current = prev[key] ?? FEATURE_BOUNDS[key];
      // Clamp so the two thumbs can never cross — dragging min past max pushes max along, and vice versa.
      const next: [number, number] =
        index === 0
          ? [Math.min(value, current[1]), current[1]]
          : [current[0], Math.max(value, current[0])];
      return { ...prev, [key]: next };
    });
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-[40rem] max-w-[95vw] overflow-y-auto rounded-lg bg-zinc-900 p-5 text-sm shadow-xl"
      >
        <h2 className="mb-3 text-lg font-semibold">Recipe: {playlistName}</h2>

        <label className="mb-1 block text-xs text-zinc-400">Include tags (any match counts)</label>
        <TagChips
          tags={includeTags}
          onChange={setIncludeTags}
          colorClass="bg-green-900 text-green-200"
        />

        <label className="mb-1 mt-3 block text-xs text-zinc-400">
          Exclude tags (any match scores 0)
        </label>
        <TagChips
          tags={excludeTags}
          onChange={setExcludeTags}
          colorClass="bg-red-900 text-red-200"
        />

        <label className="mb-2 mt-4 block text-xs text-zinc-400">Feature ranges</label>
        <div className="space-y-3">
          {FEATURE_KEYS.map((key) => {
            const enabled = featureRanges[key] !== undefined;
            const [min, max] = featureRanges[key] ?? FEATURE_BOUNDS[key];
            const [lo, hi] = FEATURE_BOUNDS[key];
            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => toggleFeature(key, e.target.checked)}
                    />
                    <span>{key}</span>
                  </label>
                  {enabled && (
                    <span className="text-xs text-zinc-400">
                      {min.toFixed(2)} – {max.toFixed(2)}
                    </span>
                  )}
                </div>
                {enabled && (
                  <div className="flex items-center gap-2 pl-5">
                    <span className="w-8 shrink-0 text-right text-xs text-zinc-500">min</span>
                    <input
                      type="range"
                      min={lo}
                      max={hi}
                      step={(hi - lo) / 100}
                      value={min}
                      onChange={(e) => setRange(key, 0, Number(e.target.value))}
                      className="flex-1"
                    />
                    <span className="w-8 shrink-0 text-xs text-zinc-500">max</span>
                    <input
                      type="range"
                      min={lo}
                      max={hi}
                      step={(hi - lo) / 100}
                      value={max}
                      onChange={(e) => setRange(key, 1, Number(e.target.value))}
                      className="flex-1"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {save.isError && (
          <p className="mt-2 text-xs text-red-400">
            Could not save — check the ranges and try again.
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded bg-zinc-700 px-3 py-1">
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded bg-green-600 px-3 py-1 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
