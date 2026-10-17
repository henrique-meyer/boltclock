import './styles.css';
import type { StreamFlash } from '../shared/messages.js';
import { openStream, type ConnectionState } from './stream.js';
import { readUrlSettings } from './url-settings.js';

const status = document.querySelector<HTMLParagraphElement>('#status');

/** Lightning data older than this is stale: no all-clear, and the display says so. */
const STALE_AFTER_MS = 3 * 60_000;

const settings = readUrlSettings(window.location.search);

if (status && !settings) {
  status.textContent = 'Add ?lat=…&lon=… to the address to watch a location.';
}

if (status && settings) {
  const flashes: StreamFlash[] = [];
  let latestFileEndMs: number | null = null;
  let connection: ConnectionState = 'connecting';
  // Server time minus local time, from the last heartbeat, so a wrong clock on the display device does not matter.
  let clockOffsetMs = 0;

  const render = () => {
    const now = Date.now() + clockOffsetMs;
    if (connection === 'ended') {
      status.textContent = 'Demo session ended. Reload to continue.';
      return;
    }
    if (connection === 'failed') {
      status.textContent = 'Lightning feed unavailable.';
      return;
    }
    const ageMs = latestFileEndMs === null ? Number.POSITIVE_INFINITY : now - latestFileEndMs;
    if (ageMs > STALE_AFTER_MS) {
      status.textContent = connection === 'open' ? 'NO LIGHTNING DATA' : 'Connecting to the lightning feed…';
      return;
    }
    const windowStart = now - settings.query.minutes * 60_000;
    const recent = flashes.filter((f) => f.timeMs >= windowStart).length;
    const { value, unit } = settings.radius;
    const strikes = recent === 1 ? '1 strike' : `${recent} strikes`;
    status.textContent = `Live · data ${Math.round(ageMs / 1000)} s old · ${strikes} within ${value} ${unit} in the last ${settings.query.minutes} min`;
  };

  openStream(settings.query, {
    onFlashes: (fresh) => {
      flashes.push(...fresh);
      render();
    },
    onHeartbeat: (heartbeat) => {
      latestFileEndMs = heartbeat.latestFileEndMs;
      clockOffsetMs = heartbeat.serverTimeMs - Date.now();
      render();
    },
    onConnection: (state) => {
      connection = state;
      render();
    },
  });
  setInterval(render, 1000);
}
