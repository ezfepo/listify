import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type Recipe } from '../lib/api';
import { RecipeEditor } from './RecipeEditor';

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api: { getRecipe: vi.fn(), putRecipe: vi.fn() },
}));

const getRecipe = vi.mocked(api.getRecipe);
const putRecipe = vi.mocked(api.putRecipe);

const emptyRecipe: Recipe = { playlistId: 3, includeTags: [], excludeTags: [], featureRanges: {} };

function setup(recipe: Recipe = emptyRecipe) {
  getRecipe.mockResolvedValue(recipe);
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <RecipeEditor playlistId={3} playlistName="Focus" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose, ...view };
}

function sliders(): HTMLInputElement[] {
  return screen.getAllByRole('slider') as HTMLInputElement[];
}

beforeEach(() => {
  getRecipe.mockReset();
  putRecipe.mockReset();
  putRecipe.mockResolvedValue({ ...emptyRecipe });
});

describe('RecipeEditor loading', () => {
  it('shows the playlist name and loads the saved recipe', async () => {
    setup({
      playlistId: 3,
      includeTags: ['ambient'],
      excludeTags: ['metal'],
      featureRanges: { energy: [0.1, 0.4] },
    });

    expect(screen.queryByText('Recipe: Focus')).not.toBeNull();
    await screen.findByText('ambient');
    expect(screen.queryByText('metal')).not.toBeNull();
    expect((screen.getByRole('checkbox', { name: 'energy' }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.queryByText('0.10 – 0.40')).not.toBeNull();
    expect(getRecipe).toHaveBeenCalledWith(3);
  });

  it('starts with every feature off for an empty recipe', async () => {
    setup();
    await waitFor(() => expect(getRecipe).toHaveBeenCalled());
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
    for (const box of screen.getAllByRole('checkbox')) {
      expect((box as HTMLInputElement).checked).toBe(false);
    }
  });
});

describe('RecipeEditor tags', () => {
  it('adds a tag on Enter, lowercased and trimmed, and clears the input', async () => {
    setup();
    const [includeInput] = screen.getAllByPlaceholderText('add tag…') as HTMLInputElement[];

    await userEvent.type(includeInput!, '  Chill Vibes {Enter}');

    expect(screen.queryByText('chill vibes')).not.toBeNull();
    expect(includeInput!.value).toBe('');
  });

  it('does not add a duplicate or an empty tag', async () => {
    setup();
    const [includeInput] = screen.getAllByPlaceholderText('add tag…') as HTMLInputElement[];

    await userEvent.type(includeInput!, 'jazz{Enter}');
    await userEvent.type(includeInput!, 'JAZZ{Enter}');
    await userEvent.type(includeInput!, '   {Enter}');

    expect(screen.getAllByText('jazz')).toHaveLength(1);
  });

  it('removes a tag with its ✕ button', async () => {
    setup({ playlistId: 3, includeTags: ['a', 'b'], excludeTags: [], featureRanges: {} });
    await screen.findByText('a');

    const chip = screen.getByText('a').closest('span') as HTMLElement;
    await userEvent.click(chip.querySelector('button') as HTMLElement);

    expect(screen.queryByText('a')).toBeNull();
    expect(screen.queryByText('b')).not.toBeNull();
  });

  it('keeps include and exclude lists separate', async () => {
    setup();
    const [includeInput, excludeInput] = screen.getAllByPlaceholderText(
      'add tag…',
    ) as HTMLInputElement[];
    await userEvent.type(includeInput!, 'rock{Enter}');
    await userEvent.type(excludeInput!, 'pop{Enter}');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putRecipe).toHaveBeenCalled());

    expect(putRecipe).toHaveBeenCalledWith(3, {
      includeTags: ['rock'],
      excludeTags: ['pop'],
      featureRanges: {},
    });
  });
});

describe('RecipeEditor feature ranges', () => {
  it('enabling a feature shows two sliders spanning its full bounds', async () => {
    setup();
    await waitFor(() => expect(getRecipe).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('checkbox', { name: 'tempo' }));

    const [min, max] = sliders();
    expect([min!.min, min!.max, min!.value]).toEqual(['0', '220', '0']);
    expect([max!.min, max!.max, max!.value]).toEqual(['0', '220', '220']);
  });

  it('uses the right bounds for loudness (-60 to 0 dB)', async () => {
    setup();
    await userEvent.click(screen.getByRole('checkbox', { name: 'loudness' }));
    const [min, max] = sliders();
    expect([min!.min, max!.max]).toEqual(['-60', '0']);
  });

  it('disabling a feature removes it from the saved recipe', async () => {
    setup({
      playlistId: 3,
      includeTags: [],
      excludeTags: [],
      featureRanges: { energy: [0.2, 0.6], valence: [0, 0.5] },
    });
    await screen.findByText('0.20 – 0.60');

    await userEvent.click(screen.getByRole('checkbox', { name: 'energy' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putRecipe).toHaveBeenCalled());

    expect(putRecipe.mock.calls[0]?.[1].featureRanges).toEqual({ valence: [0, 0.5] });
  });

  it('the two thumbs cannot cross: min is clamped to max and max to min', async () => {
    setup();
    await userEvent.click(screen.getByRole('checkbox', { name: 'energy' }));

    const minSlider = () => sliders()[0]!;
    const maxSlider = () => sliders()[1]!;

    fireEvent.change(maxSlider(), { target: { value: '0.3' } });
    expect(maxSlider().value).toBe('0.3');

    fireEvent.change(minSlider(), { target: { value: '0.8' } }); // past max: pushed back to 0.3
    expect(minSlider().value).toBe('0.3');
    expect(screen.queryByText('0.30 – 0.30')).not.toBeNull();

    fireEvent.change(maxSlider(), { target: { value: '0.1' } }); // below min: pushed up to 0.3
    expect(maxSlider().value).toBe('0.3');
  });

  it('saves the adjusted range', async () => {
    setup();
    await userEvent.click(screen.getByRole('checkbox', { name: 'danceability' }));
    const [min, max] = sliders();
    fireEvent.change(min!, { target: { value: '0.25' } });
    fireEvent.change(max!, { target: { value: '0.75' } });

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putRecipe).toHaveBeenCalled());

    expect(putRecipe.mock.calls[0]?.[1].featureRanges).toEqual({ danceability: [0.25, 0.75] });
  });
});

describe('RecipeEditor save and close', () => {
  it('closes after a successful save', async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('stays open and shows an error when the save fails', async () => {
    putRecipe.mockRejectedValue(new Error('bad range'));
    const { onClose } = setup();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText(/Could not save/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables Save while a save is in flight', async () => {
    let finish: (r: Recipe) => void = () => {};
    putRecipe.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    setup();

    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    await userEvent.click(save);
    await waitFor(() => expect(save.disabled).toBe(true));

    finish(emptyRecipe);
    await waitFor(() => expect(save.disabled).toBe(false));
  });

  it('Cancel closes without saving', async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(putRecipe).not.toHaveBeenCalled();
  });

  it('clicking the backdrop closes, but clicking inside the dialog does not', async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByText('Recipe: Focus'));
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = screen.getByText('Recipe: Focus').parentElement?.parentElement as HTMLElement;
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
