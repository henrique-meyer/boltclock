# System design (technology-neutral)

## Components
1. **Lightning ingest service** (server-side, always running): detects each new GLM-L2-LCFA file from GOES-19, downloads it, and extracts each flash (id, absolute time, lat, lon). It keeps a rolling 60-min buffer.
2. **Push channel**: a persistent server→browser connection that streams new flashes and a periodic heartbeat (including the end time of the latest processed file). On connect, it replays the 60-min buffer.
3. **Weather relay** (server-side): fetches api.weather.gov with the required User-Agent and caches responses. It exists because browsers cannot set User-Agent.
4. **Location picker** (browser): Google Maps JavaScript API map + draggable pin + Places Autocomplete, using the deployer-supplied key from config. It defaults to browser geolocation, falling back to the saved point, then a default view. Search only repositions the pin. Only the pin's lat/lon is persisted. There is no server-side geocoding.
5. **Display client** (browser): settings, distance filtering, state machine, countdown, audio, rendering.

## Data flow
GOES-19 GLM file published (~every 20 s) → ingest learns of it (by polling the listing, or a new-object notification) → parse flashes → push to clients → client computes distance → state machine → audio + UI.
Weather: client → relay → api.weather.gov `/points/{lat,lon}` (cached) → hourly forecast + nearest station latest observation. Suggested refresh: observations ~10 min, forecast ~30 min.

## Client state machine
- **NORMAL** → a flash within radius → **ALERT** (countdownEnd = flash.time + limit; audio A).
- **ALERT** + a flash within radius → countdownEnd = max(countdownEnd, flash.time + limit); audio if the replay setting is on.
- **ALERT** and now ≥ countdownEnd and data fresh → **NORMAL** (audio B).
- **STALE** overlay: heartbeat age >3 min. It suppresses all-clear until fresh again.
- Deduplicate flashes by id. Ignore flashes older than the time limit.

## Data characteristics (verified 2026-10-16)
- Files: `OR_GLM-L2-LCFA_G19_s…_e…_c….nc`, 20-s windows, under `GLM-L2-LCFA/YYYY/DDD/HH/`. Measured arrival was ~20–40 s after window end, so flash-to-availability is ~20–60 s.
- New-object notifications: the SNS topic `arn:aws:sns:us-east-1:123901341784:NewGOES19Object`.
- GOES-East covers Florida well. GLM resolution is ~8 km, it detects total lightning (in-cloud + cloud-to-ground), and detection is <100%. Minimum sensible radius is ~10 mi. The UI and README must state "Strike locations are accurate within ±5 miles."

## Deployment shape
One container image serves the client, the push channel and the weather relay on one port, plus a browser in kiosk/full-screen mode. The reference deployment is Azure Container Apps with one always-on replica ([ADR 0001](decisions/0001-container-apps.md), [infra/README.md](../infra/README.md)). Any host that runs a container around the clock also works, such as a mini PC on the display's LAN.
- Stateless: on start, ingest rebuilds the 60-min buffer from the GLM bucket, so restarts and new revisions lose nothing. No database or volume.
- One replica. More would each ingest the same files.
- `GET /health` reports process health only. Stale lightning data is shown on the display, never used to restart the container.
- Proxies may cut long-lived requests (Azure Container Apps: 240 s). The client reconnects, the server replays the buffer, and flashes are deduplicated by id.
- Run it close to AWS us-east-1 for the lowest GLM latency.
- Demo deployments ([ADR 0003](decisions/0003-demo-scale-to-zero.md)) scale to zero between visits and set a session limit. When the limit is reached, the server ends the push stream with a "session ended" event. The client stops reconnecting, treats the data as stale (so it never announces all-clear), and asks for a reload. After a cold start the display shows "NO LIGHTNING DATA" until the buffer is rebuilt.

## Safety
Not a certified lightning warning system. Disclose latency, positional error ("Strike locations are accurate within ±5 miles."), and missed detections.
