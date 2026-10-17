import './weather-panel.css';
import { OBSERVATION_REFRESH_MS, type WeatherResponse } from '../shared/weather.js';
import { messageView, weatherPanelView, type WeatherPanelView } from './weather-format.js';

/** After a failed request, ask again this soon. */
const RETRY_MS = 60_000;
/** Outside NWS coverage nothing will change soon; check again rarely. */
const OUTSIDE_COVERAGE_REFRESH_MS = 6 * 60 * 60_000;
/** How often the "observed N min ago" line is redrawn. */
const AGE_TICK_MS = 30_000;

/** GET /api/weather for a point. The point is sent at NWS's own precision (4 decimals, about 11 m). */
export async function fetchWeather(point: { lat: number; lon: number }, fetcher: typeof fetch = fetch): Promise<WeatherResponse> {
  const params = new URLSearchParams({ lat: point.lat.toFixed(4), lon: point.lon.toFixed(4) });
  const response = await fetcher(`/api/weather?${params}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`The weather relay answered ${response.status}.`);
  const body = (await response.json()) as WeatherResponse;
  if (body?.status !== 'ok' && body?.status !== 'outside-coverage') throw new Error('The weather relay sent something unexpected.');
  return body;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function render(root: HTMLElement, view: WeatherPanelView): void {
  root.classList.toggle('weather-panel--stale', view.stale);
  const children: HTMLElement[] = [];
  if (view.place) children.push(el('p', 'weather-place', view.place));
  if (view.message) {
    children.push(el('p', 'weather-message', view.message));
  } else {
    const now = el('div', 'weather-now');
    if (view.temperature) now.append(el('span', 'weather-temp', view.temperature));
    const words = el('div', 'weather-words');
    words.append(el('span', 'weather-condition', view.condition));
    if (view.wind) words.append(el('span', 'weather-wind', view.wind));
    now.append(words);
    children.push(now);
    if (view.forecast.length) {
      const list = el('ol', 'weather-forecast');
      list.setAttribute('aria-label', 'Next hours');
      for (const hour of view.forecast) {
        const item = el('li', 'weather-hour');
        item.append(
          el('span', 'weather-hour-time', hour.time),
          el('span', 'weather-hour-temp', hour.temperature),
          el('span', 'weather-hour-text', hour.text),
        );
        if (hour.precipitation) {
          const chance = el('span', 'weather-hour-precip', hour.precipitation);
          chance.title = 'Chance of precipitation';
          item.append(chance);
        }
        list.append(item);
      }
      children.push(list);
    }
  }
  children.push(el('p', 'weather-credit', view.credit));
  root.replaceChildren(...children);
}

/**
 * Shows current weather and the next hours for a point in the display's weather slot (`.weather`), refreshing about
 * every 10 minutes like the relay's observations. The panel draws inside its own wrapper, so the slot's place in the
 * display's layout stays the layout's business. Does nothing without a slot. Returns a function that stops it.
 */
export function mountWeatherPanel(slot: HTMLElement | null, point: { lat: number; lon: number }): () => void {
  if (!slot) return () => {};
  slot.classList.add('weather');
  const root = el('div', 'weather-panel');
  slot.replaceChildren(root);
  render(root, messageView('Loading the weather…'));

  let last: WeatherResponse | undefined;
  let stopped = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  const draw = (failed = false) => {
    if (!last) {
      if (failed) render(root, messageView('Weather unavailable.'));
      return;
    }
    const view = weatherPanelView(last, Date.now());
    // A failed refresh keeps the last weather on screen, marked stale.
    render(root, failed ? { ...view, stale: true } : view);
  };

  let failed = false;
  const refresh = async () => {
    let nextMs = OBSERVATION_REFRESH_MS;
    try {
      last = await fetchWeather(point);
      failed = false;
      if (last.status === 'outside-coverage') nextMs = OUTSIDE_COVERAGE_REFRESH_MS;
    } catch {
      failed = true;
      nextMs = RETRY_MS;
    }
    if (stopped) return;
    draw(failed);
    refreshTimer = setTimeout(() => void refresh(), nextMs);
  };

  const ageTimer = setInterval(() => draw(failed), AGE_TICK_MS);
  void refresh();
  return () => {
    stopped = true;
    clearTimeout(refreshTimer);
    clearInterval(ageTimer);
  };
}
