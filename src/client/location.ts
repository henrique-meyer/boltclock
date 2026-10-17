import './styles.css';
import './location.css';
import { fetchClientConfig, loadGoogleMaps } from './client-config.js';
import {
  DEFAULT_RADIUS,
  loadLocation,
  normalizePoint,
  parseRadius,
  radiusMeters,
  saveLocation,
  type Point,
  type Radius,
} from './location-settings.js';
import { googlePlacesBackend, PlaceSearch, type GoogleSuggestion } from './place-search.js';

/** The continental US, for when there is neither a saved point nor a browser location. */
const DEFAULT_VIEW = { center: { lat: 39.5, lng: -98.35 }, zoom: 4 };
const POINT_ZOOM = 10;
const GEOLOCATION_TIMEOUT_MS = 10_000;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const searchInput = el<HTMLInputElement>('search-input');
const searchResults = el<HTMLUListElement>('search-results');
const searchPopup = el<HTMLDivElement>('search-popup');
const radiusValue = el<HTMLInputElement>('radius-value');
const radiusUnit = el<HTMLSelectElement>('radius-unit');
const radiusError = el<HTMLParagraphElement>('radius-error');
const pointReadout = el<HTMLParagraphElement>('point-readout');
const saveButton = el<HTMLButtonElement>('save');
const status = el<HTMLParagraphElement>('picker-status');
const mapElement = el<HTMLDivElement>('map');

const saved = loadLocation(localStorage);
let point: Point | undefined = saved?.point;
let radius: Radius | undefined = saved?.radius ?? DEFAULT_RADIUS;
let dirty = false;

radiusValue.value = String(radius.value);
radiusUnit.value = radius.unit;

const toLatLng = (p: Point): google.maps.LatLngLiteral => ({ lat: p.lat, lng: p.lon });

/** The browser's location, or undefined when it is denied, unavailable or slow. Never stored unless saved. */
function currentPosition(): Promise<Point | undefined> {
  if (!('geolocation' in navigator)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lon: coords.longitude }),
      () => resolve(undefined),
      { timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 10 * 60_000 },
    );
  });
}

function readRadius(): void {
  const input = parseRadius(radiusValue.value, radiusUnit.value === 'km' ? 'km' : 'mi');
  radius = input.ok ? input.radius : undefined;
  radiusError.hidden = input.ok;
  radiusError.textContent = input.ok ? '' : input.message;
}

function updateControls(): void {
  pointReadout.textContent = point
    ? `Point: ${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`
    : 'No point set yet. Click the map or search for a place.';
  saveButton.disabled = !point || !radius;
}

async function start(): Promise<void> {
  let config;
  try {
    config = await fetchClientConfig();
  } catch {
    status.textContent = 'Could not reach the server. Reload to try again.';
    return;
  }
  if (!config.googleMapsApiKey) {
    status.textContent = 'The map needs a Google Maps key. Set GOOGLE_MAPS_API_KEY on the server (see the README).';
    return;
  }

  // A saved pin wins, so the browser's location is asked for only when there is none.
  const [here] = await Promise.all([
    point ? Promise.resolve(undefined) : currentPosition(),
    loadGoogleMaps(config.googleMapsApiKey, () => {
      status.textContent = 'Google Maps refused the key for this address. Check the key\'s website restrictions.';
    }),
  ]);
  const [{ Map, Circle }, { AdvancedMarkerElement }, places] = await Promise.all([
    google.maps.importLibrary('maps'),
    google.maps.importLibrary('marker'),
    google.maps.importLibrary('places'),
  ]);

  // Open on the saved pin, then the browser's location, then the default view.
  const center = point ?? here;
  const map = new Map(mapElement, {
    center: center ? toLatLng(center) : DEFAULT_VIEW.center,
    zoom: center ? POINT_ZOOM : DEFAULT_VIEW.zoom,
    mapId: config.googleMapsMapId,
    clickableIcons: false,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: false,
  });
  // With nothing saved yet, the pin starts at the browser's location. It is kept only if the user saves.
  if (!point && here) {
    point = normalizePoint(here);
    dirty = true;
    status.textContent = 'The pin is at your location. Move it if needed, then save.';
  } else if (!point) {
    status.textContent = 'Your location is not available. Find your area, then click the map or search to set the point.';
  }

  const marker = new AdvancedMarkerElement({ gmpDraggable: true, title: 'Lightning point. Drag to move.' });
  const circle = new Circle({
    map,
    clickable: false,
    strokeColor: '#4cc9f0',
    strokeWeight: 2,
    fillColor: '#4cc9f0',
    fillOpacity: 0.12,
  });

  const draw = () => {
    marker.map = point ? map : null;
    if (point) marker.position = toLatLng(point);
    circle.setVisible(Boolean(point && radius));
    if (point) circle.setCenter(toLatLng(point));
    if (radius) circle.setRadius(radiusMeters(radius));
    updateControls();
  };

  const setPoint = (next: Point, fit = false) => {
    point = normalizePoint(next);
    dirty = true;
    status.textContent = '';
    draw();
    if (fit && radius) {
      const bounds = circle.getBounds();
      if (bounds) map.fitBounds(bounds);
    } else if (fit) {
      map.panTo(toLatLng(point));
    }
  };

  map.addListener('click', (event: google.maps.MapMouseEvent) => {
    if (event.latLng) setPoint({ lat: event.latLng.lat(), lon: event.latLng.lng() });
  });
  marker.addEventListener('gmp-dragend', () => {
    const position = marker.position;
    if (!position) return;
    const latLng = position instanceof google.maps.LatLng ? position : new google.maps.LatLng(position);
    setPoint({ lat: latLng.lat(), lon: latLng.lng() });
  });

  for (const control of [radiusValue, radiusUnit]) {
    control.addEventListener('input', () => {
      readRadius();
      dirty = true;
      status.textContent = '';
      draw();
    });
  }

  saveButton.addEventListener('click', () => {
    if (!point || !radius) return;
    try {
      const stored = saveLocation(localStorage, { point, radius });
      point = stored.point;
      dirty = false;
      status.textContent = `Saved on this device: ${stored.radius.value} ${stored.radius.unit} around the pin.`;
      // Straight back to the display, which starts watching the new point. A failed save stays here.
      window.location.assign('/');
    } catch {
      status.textContent = 'This browser would not save the location. Check that site data is allowed.';
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (dirty) event.preventDefault();
  });

  draw();
  // Frame the pin's circle.
  if (point && radius) {
    const bounds = circle.getBounds();
    if (bounds) map.fitBounds(bounds);
  }

  setUpSearch(googlePlacesBackend(places), (found) => setPoint(found, true));
}

function setUpSearch(backend: ReturnType<typeof googlePlacesBackend>, onPlace: (point: Point) => void): void {
  let shown: GoogleSuggestion[] = [];
  let active = -1;

  const render = (suggestions: GoogleSuggestion[]) => {
    shown = suggestions;
    active = -1;
    searchResults.replaceChildren(
      ...suggestions.map((suggestion, index) => {
        const item = document.createElement('li');
        item.id = `search-result-${index}`;
        item.role = 'option';
        const main = document.createElement('span');
        main.className = 'result-main';
        main.textContent = suggestion.main;
        const secondary = document.createElement('span');
        secondary.className = 'result-secondary';
        secondary.textContent = suggestion.secondary;
        item.append(main, secondary);
        // mousedown, not click, so the choice lands before the input loses focus.
        item.addEventListener('mousedown', (event) => {
          event.preventDefault();
          void choose(suggestion);
        });
        return item;
      }),
    );
    const open = suggestions.length > 0;
    searchPopup.hidden = !open;
    searchInput.setAttribute('aria-expanded', String(open));
    searchInput.removeAttribute('aria-activedescendant');
  };

  const search = new PlaceSearch(backend, {
    onSuggestions: render,
    onError: () => {
      render([]);
      status.textContent = 'Place search is unavailable right now. Click the map to set the point.';
    },
  });

  const choose = async (suggestion: GoogleSuggestion) => {
    // Clear the box first: the search text is not kept anywhere once a place is chosen.
    searchInput.value = '';
    try {
      const found = await search.choose(suggestion);
      if (found) onPlace(found);
      else status.textContent = 'That place has no location. Try another, or click the map.';
    } catch {
      status.textContent = 'Could not look up that place. Try again, or click the map.';
    }
  };

  const highlight = (index: number) => {
    active = index;
    [...searchResults.children].forEach((item, i) => item.setAttribute('aria-selected', String(i === index)));
    if (index >= 0) searchInput.setAttribute('aria-activedescendant', `search-result-${index}`);
    else searchInput.removeAttribute('aria-activedescendant');
  };

  searchInput.addEventListener('input', () => search.input(searchInput.value));
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && shown.length) {
      event.preventDefault();
      highlight((active + 1) % shown.length);
    } else if (event.key === 'ArrowUp' && shown.length) {
      event.preventDefault();
      highlight((active - 1 + shown.length) % shown.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const suggestion = shown[active >= 0 ? active : 0];
      if (suggestion) void choose(suggestion);
    } else if (event.key === 'Escape') {
      searchInput.value = '';
      search.input('');
    }
  });
  searchInput.addEventListener('blur', () => render([]));
  searchInput.disabled = false;
}

readRadius();
updateControls();
void start();
