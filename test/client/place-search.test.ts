import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  googlePlacesBackend,
  PlaceSearch,
  SEARCH_DEBOUNCE_MS,
  type PlacesBackend,
  type PlacesLibrary,
  type Suggestion,
} from '../../src/client/place-search.js';

const SEARCH_TEXT = '400 S Orange Ave';

function fakeBackend() {
  let tokens = 0;
  type Backend = PlacesBackend<Suggestion, string>;
  return {
    createSessionToken: vi.fn<Backend['createSessionToken']>(() => `token-${++tokens}`),
    suggest: vi.fn<Backend['suggest']>(async (input) => [{ main: input, secondary: 'FL, USA' }]),
    locate: vi.fn<Backend['locate']>(async () => ({ lat: 28.5383, lon: -81.3792 })),
  };
}

function setUp(backend = fakeBackend()) {
  const onSuggestions = vi.fn();
  const onError = vi.fn();
  const search = new PlaceSearch(backend, { onSuggestions, onError });
  return { backend, search, onSuggestions, onError };
}

/** Lets the debounce fire and the backend's promise settle. */
async function settle(ms = SEARCH_DEBOUNCE_MS) {
  await vi.advanceTimersByTimeAsync(ms);
}

const consoleMethods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

beforeEach(() => {
  vi.useFakeTimers();
  for (const method of consoleMethods) vi.spyOn(console, method);
});

afterEach(() => {
  // Nothing in the search path may write the search text, or anything else, to the console.
  for (const method of consoleMethods) expect(console[method]).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('PlaceSearch', () => {
  it('waits for typing to pause before asking for suggestions', async () => {
    const { backend, search, onSuggestions } = setUp();
    for (const text of ['O', 'Or', 'Orl', 'Orla', 'Orlan', 'Orlando']) {
      search.input(text);
      await settle(SEARCH_DEBOUNCE_MS / 4);
    }
    expect(backend.suggest).not.toHaveBeenCalled();

    await settle();
    expect(backend.suggest).toHaveBeenCalledTimes(1);
    expect(backend.suggest).toHaveBeenCalledWith('Orlando', 'token-1');
    expect(onSuggestions).toHaveBeenLastCalledWith([{ main: 'Orlando', secondary: 'FL, USA' }]);
  });

  it('needs three characters', async () => {
    const { backend, search, onSuggestions } = setUp();
    search.input(' Or ');
    await settle();

    expect(backend.suggest).not.toHaveBeenCalled();
    expect(onSuggestions).toHaveBeenLastCalledWith([]);
  });

  it('uses one session token for a search and a new one after a place is chosen', async () => {
    const { backend, search } = setUp();
    search.input('Orl');
    await settle();
    search.input('Orlando');
    await settle();
    const [first] = await backend.suggest.mock.results[1]!.value;
    const point = await search.choose(first!);

    expect(point).toEqual({ lat: 28.5383, lon: -81.3792 });
    expect(backend.suggest.mock.calls.map(([, token]) => token)).toEqual(['token-1', 'token-1']);
    expect(backend.locate).toHaveBeenCalledTimes(1);

    search.input('Tampa');
    await settle();
    expect(backend.suggest).toHaveBeenLastCalledWith('Tampa', 'token-2');
  });

  it('starts a new session after the box is cleared', async () => {
    const { backend, search } = setUp();
    search.input('Orlando');
    await settle();
    search.input('');
    search.input('Tampa');
    await settle();

    expect(backend.suggest.mock.calls.map(([, token]) => token)).toEqual(['token-1', 'token-2']);
  });

  it('drops a slow answer to an older input', async () => {
    const backend = fakeBackend();
    let release: (value: Suggestion[]) => void = () => undefined;
    backend.suggest.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const { search, onSuggestions } = setUp(backend);

    search.input('Orl');
    await settle();
    search.input('Orlando');
    await settle();
    release([{ main: 'Orl', secondary: 'stale' }]);
    await settle(0);

    expect(onSuggestions).toHaveBeenCalledTimes(1);
    expect(onSuggestions).toHaveBeenLastCalledWith([{ main: 'Orlando', secondary: 'FL, USA' }]);
  });

  it('clears the list when a place is chosen and ignores a pending request', async () => {
    const { backend, search, onSuggestions } = setUp();
    search.input('Orlando');
    await search.choose({ main: 'Orlando', secondary: '' });
    await settle();

    expect(backend.suggest).not.toHaveBeenCalled();
    expect(onSuggestions).toHaveBeenLastCalledWith([]);
  });

  it('reports a failed request without the search text', async () => {
    const backend = fakeBackend();
    backend.suggest.mockRejectedValueOnce(new Error(`quota exceeded for "${SEARCH_TEXT}"`));
    const { search, onError } = setUp(backend);
    search.input(SEARCH_TEXT);
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith();
  });
});

describe('googlePlacesBackend', () => {
  function fakePlaces() {
    const place = {
      location: { lat: () => 28.5383, lng: () => -81.3792 } as google.maps.LatLng | undefined,
      fetchFields: vi.fn(async () => ({ place })),
    };
    const prediction = {
      text: { text: 'Orlando, FL, USA' },
      mainText: { text: 'Orlando' },
      secondaryText: { text: 'FL, USA' },
      toPlace: vi.fn(() => place),
    };
    class AutocompleteSessionToken {}
    const fetchAutocompleteSuggestions = vi.fn(async () => ({
      suggestions: [{ placePrediction: prediction }, { placePrediction: null }],
    }));
    const library = {
      AutocompleteSessionToken,
      AutocompleteSuggestion: { fetchAutocompleteSuggestions },
    } as unknown as PlacesLibrary;
    return { library, place, prediction, fetchAutocompleteSuggestions, AutocompleteSessionToken };
  }

  it('sends the session token with each autocomplete request and keeps only place predictions', async () => {
    const { library, fetchAutocompleteSuggestions, AutocompleteSessionToken } = fakePlaces();
    const backend = googlePlacesBackend(library);
    const token = backend.createSessionToken();
    const suggestions = await backend.suggest('Orlando', token);

    expect(token).toBeInstanceOf(AutocompleteSessionToken);
    expect(fetchAutocompleteSuggestions).toHaveBeenCalledWith({ input: 'Orlando', sessionToken: token });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ main: 'Orlando', secondary: 'FL, USA' });
  });

  it('ends the session with a details call for the location only', async () => {
    const { library, place, prediction } = fakePlaces();
    const backend = googlePlacesBackend(library);
    const [suggestion] = await backend.suggest('Orlando', backend.createSessionToken());
    const point = await backend.locate(suggestion!);

    expect(prediction.toPlace).toHaveBeenCalledTimes(1);
    expect(place.fetchFields).toHaveBeenCalledWith({ fields: ['location'] });
    expect(point).toEqual({ lat: 28.5383, lon: -81.3792 });
  });

  it('returns nothing for a place without a location', async () => {
    const { library, place } = fakePlaces();
    place.location = undefined;
    const backend = googlePlacesBackend(library);
    const [suggestion] = await backend.suggest('Orlando', backend.createSessionToken());

    expect(await backend.locate(suggestion!)).toBeUndefined();
  });
});
