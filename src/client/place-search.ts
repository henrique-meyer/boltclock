import type { Point } from './location-settings.js';

/**
 * Address search for the location picker, on Places API (New).
 *
 * Billing: autocomplete requests that share a session token, ended by one Place Details call, are billed as one
 * session. Each search gets a fresh token on its first request, keeps it while the user types, and drops it once a
 * suggestion is chosen (the details call ends the session) or the box is cleared. Typing is debounced and needs a few
 * characters, because the deployment's daily request caps are small.
 *
 * Privacy: the search text and the suggestions stay in memory. Nothing here stores or logs them, and choosing a
 * suggestion yields only its coordinates.
 */

export interface Suggestion {
  /** The place's name, e.g. "Orlando". */
  main: string;
  /** What tells it apart, e.g. "FL, USA". May be empty. */
  secondary: string;
}

export interface PlacesBackend<S extends Suggestion, Token> {
  createSessionToken(): Token;
  suggest(input: string, sessionToken: Token): Promise<S[]>;
  /** Fetches the chosen suggestion's location. This ends the session. */
  locate(suggestion: S): Promise<Point | undefined>;
}

export interface PlaceSearchOptions<S> {
  onSuggestions(suggestions: S[]): void;
  /** Called with no details on purpose: an error message could carry the search text. */
  onError(): void;
  debounceMs?: number;
  minChars?: number;
}

export const SEARCH_DEBOUNCE_MS = 400;
export const SEARCH_MIN_CHARS = 3;

export class PlaceSearch<S extends Suggestion, Token> {
  private readonly debounceMs: number;
  private readonly minChars: number;
  private sessionToken: Token | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped on every change, so a slow answer to an older input is dropped. */
  private generation = 0;

  constructor(
    private readonly backend: PlacesBackend<S, Token>,
    private readonly options: PlaceSearchOptions<S>,
  ) {
    this.debounceMs = options.debounceMs ?? SEARCH_DEBOUNCE_MS;
    this.minChars = options.minChars ?? SEARCH_MIN_CHARS;
  }

  /** The search box changed. */
  input(text: string): void {
    this.cancelPending();
    const query = text.trim();
    if (query === '') {
      // An abandoned search: the next one is a new session.
      this.sessionToken = undefined;
      this.options.onSuggestions([]);
      return;
    }
    if (query.length < this.minChars) {
      this.options.onSuggestions([]);
      return;
    }

    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.sessionToken ??= this.backend.createSessionToken();
      this.backend.suggest(query, this.sessionToken).then(
        (suggestions) => {
          if (generation === this.generation) this.options.onSuggestions(suggestions);
        },
        () => {
          if (generation === this.generation) this.options.onError();
        },
      );
    }, this.debounceMs);
  }

  /** The user picked a suggestion: fetch its location and end the session. */
  async choose(suggestion: S): Promise<Point | undefined> {
    this.cancelPending();
    this.sessionToken = undefined;
    this.options.onSuggestions([]);
    return this.backend.locate(suggestion);
  }

  /** Stops any pending request, e.g. when the page goes away. */
  cancelPending(): void {
    this.generation++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/** The pieces of the Maps JavaScript API "places" library that the backend uses. */
export type PlacesLibrary = Pick<google.maps.PlacesLibrary, 'AutocompleteSuggestion' | 'AutocompleteSessionToken'>;

export interface GoogleSuggestion extends Suggestion {
  prediction: google.maps.places.PlacePrediction;
}

/** The backend on Places API (New): AutocompleteSuggestion, then Place Details for `location` only. */
export function googlePlacesBackend(
  places: PlacesLibrary,
): PlacesBackend<GoogleSuggestion, google.maps.places.AutocompleteSessionToken> {
  return {
    createSessionToken: () => new places.AutocompleteSessionToken(),

    async suggest(input, sessionToken) {
      const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input, sessionToken });
      return suggestions.flatMap(({ placePrediction: prediction }) =>
        prediction
          ? [{ prediction, main: (prediction.mainText ?? prediction.text).text, secondary: prediction.secondaryText?.text ?? '' }]
          : [],
      );
    },

    async locate({ prediction }) {
      // toPlace() carries the session token, so this details call closes the session. Location is the only field
      // requested: it is all the picker keeps, and the cheapest details call.
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ['location'] });
      const location = place.location;
      return location ? { lat: location.lat(), lon: location.lng() } : undefined;
    },
  };
}
