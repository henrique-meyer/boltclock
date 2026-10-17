# boltclock
Full-screen lightning alarm for any location. When NOAA satellite data shows a strike within your radius, it sounds a siren, calls out the distance, and runs an all-clear countdown, with live weather readable from across the room.

## Safety
**Not a certified lightning warning system. When thunder roars, go indoors.**

**Strike locations are accurate within ±5 miles.** The satellite detects most lightning but not all of it, and each strike reaches the display about 20 to 60 seconds after it happens.

## Run locally
You need Node 24 and npm.

```bash
npm ci
cp .env.example .env
npm run dev
```

Open http://localhost:5173. Vite serves the client and forwards `/health` and the API to the server on port 8080. Fill in `.env` first: an identifying `NWS_USER_AGENT` and a `GOOGLE_MAPS_API_KEY` (see [Google Maps key](#google-maps-key)).

`npm run dev` also reads `.env.local`, which git ignores, and its values win over `.env`. Put a key restricted to localhost there, so `.env` can keep the key for your site:

```bash
echo "GOOGLE_MAPS_API_KEY=<your localhost key>" > .env.local
```

The production build runs everything from one port:

```bash
npm run build
npm start
```

Or as a container:

```bash
docker build -t boltclock .
docker run --rm --publish 8080:8080 --env-file .env boltclock
```

Add `--env-file .env.local` after `--env-file .env` to use the localhost key there too.

Checks: `npm run lint`, `npm run typecheck` and `npm test`.

## Choosing the location
Open `/location.html` (the "Location" link under the display). Search for a place, click the map or drag the pin, set the radius in miles or kilometres (10 mi by default, at most 100 mi or 160.9 km), and save. Saving goes straight back to the display, which then watches the new point; if the browser will not save, the picker stays open and says why. A search only moves the pin. The map opens on the browser's location if it is allowed, otherwise on the saved point.

Only the pin's coordinates and the radius are saved, in the browser's local storage on the display device. Addresses and search text are never stored or logged.

The display watches the saved location. A kiosk can be pinned to a point by its address instead, which overrides the saved one: `/?lat=28.54&lon=-81.38&radius=10&unit=mi&minutes=30` (`radius`, `unit` and `minutes` are optional).

## Using the display
Press **Start display**. That one click turns on sound, which browsers only allow after a user gesture. The full-screen button at the top right, next to the gear (Settings) and map pin (Location) buttons, or F11, fills the screen and hides the top-bar buttons; Esc or F11 brings them back. If sound is still off, a "click to enable sound" banner stays up until it's on.

- **All clear:** the calm navy screen.
- **Lightning nearby:** a strike inside the radius turns the screen red and starts an MM:SS countdown, counted from the strike's own time. It plays the siren, then "Lightning detected N miles away" (in the unit the radius was entered in). Each new strike in the radius restarts the countdown.
- **All-clear sound:** when the countdown ends, a chime plays, then "No lightning detected in the area."
- **NO LIGHTNING DATA:** shown over everything when the newest satellite file is more than 3 minutes old. The display never announces an all-clear while it shows.

**Settings** (saved on this device):
- the siren: two-tone, mechanical, yelp, or none;
- the volume;
- whether new strikes replay the siren during a countdown (off by default: later strikes only restart the countdown);
- whether the announcement is spoken after the siren or chime (on by default; with no siren and no announcement, alerts are silent);
- the countdown length: 30 minutes by default, at most 120. An address with `minutes=` pins it on a kiosk;
- the clock for forecast times: 12-hour (the default) or 24-hour;
- the temperature unit: °F (the default) or °C.

The settings also have test buttons for both sounds.

**Test mode:** with `TEST_MODE=true` (Bicep parameter `testMode`), the top bar offers **Simulate a strike** (the bolt). It puts a fake strike at a random distance inside the radius, in a random direction, through the same logic as a real one, labelled as a test on screen. Every test strike sounds the alarm, even during a countdown with replay off. During a countdown, **Simulate all clear** (the sun) ends it at once with the all-clear sound. It lives only in that browser tab: nothing is stored or sent. Keep it off on a real display.

### Kiosk
For an always-on screen, open the display in a browser's kiosk mode, with a flag that allows sound without a click. For example, Chrome:

```bash
chrome --kiosk --autoplay-policy=no-user-gesture-required "https://your-domain.example/?lat=28.54&lon=-81.38&radius=10&unit=mi"
```

The display still shows the Start button once. With that flag, the alarm can sound even before anyone presses it.

## Google Maps keyEach deployment brings its own Google Maps Platform key; none is in this repository. The server reads it from `GOOGLE_MAPS_API_KEY` at runtime and hands it to the location picker, so the same image works anywhere. A browser key is visible to every visitor, which is why its restrictions matter.

1. In the Google Cloud console, create a project with billing, and enable the **Maps JavaScript API** and **Places API (New)**.
2. Create an API key and restrict it:
   - Application restrictions: **Websites**, with your site, e.g. `https://your-domain.example/*`.
   - API restrictions: Maps JavaScript API and Places API (New) only.
3. For local work, create a second key with the same API restrictions and the websites `http://localhost:5173/*` and `http://localhost:8080/*`, and put it in `.env.local`.
4. Optional: cap daily usage under Quotas (map loads, `AutocompletePlacesRequest`, `GetPlaceRequest`). The picker waits for a pause in typing and groups each search into one billed session that ends with a details request for the location only.
5. Optional: create a Map ID (Map Management, JavaScript, vector) and set `GOOGLE_MAPS_MAP_ID`. Without it the map uses Google's `DEMO_MAP_ID`.

## Data and credits
- Lightning: NOAA GOES-19 Geostationary Lightning Mapper (GLM-L2-LCFA), public domain, from NOAA Open Data on AWS. No account needed.
- Weather: the National Weather Service API (api.weather.gov).
- Maps: Google Maps Platform, with Google's attribution kept on the map. Each deployer supplies their own key; none is in this repository.

## Tech stack
- **Language and runtime:** TypeScript on Node 24 LTS for the server, the ingest function and the browser client ([ADR 0002](docs/decisions/0002-node-typescript.md)).
- **Server:** Fastify, serving the display, `/health`, the push channel (server-sent events at `/api/stream`) and the weather relay (`/api/weather`).
- **Client:** Vite and plain TypeScript, with no UI framework. Sound is played with the Web Audio API, falling back to the browser's speech synthesis.
- **Lightning data:** NOAA GOES-19 Geostationary Lightning Mapper (GLM-L2-LCFA) NetCDF4 files, read with `h5wasm` (the HDF5 library compiled to WebAssembly) ([format notes](docs/glm-format.md)).
- **Ingest:** NOAA's new-object notifications (Amazon SNS) reach an AWS Lambda relay, then an Azure Function that verifies NOAA's signature and stores flashes in Azure Table Storage, partitioned by 1° grid cell ([ADR 0004](docs/decisions/0004-webhook-ingest-table-storage.md)).
- **Weather and maps:** the National Weather Service API, and the Google Maps JavaScript API with Places for the location picker.
- **Infrastructure as code:** Bicep for Azure and CloudFormation for AWS. Every name and value is a parameter.
- **Delivery:** Docker images on GitHub Container Registry. GitHub Actions run lint, typecheck, tests, the build, an image health check and IaC linting on every pull request, and deploy every merge to `main` with OIDC (no stored cloud passwords).
- **Tests:** Vitest. The GLM parser is checked flash for flash against an independent `xarray` read of a real file.

## Hosting
The reference deployment is Azure, plus a small relay in AWS. Resource names, the subscription and any custom domain stay out of this repo. [infra/README.md](infra/README.md) lists each resource's settings and the deploy steps.

```
NOAA GOES-19 bucket ──new-object notification (SNS)──▶ AWS Lambda relay ──HTTPS──▶ Azure Function (verifies NOAA's signature)
                                                                                     │ download, parse, store
browser display ◀── Azure Container App (Fastify) ◀── reads nearby flashes ── Azure Table Storage (hourly tables, 120 min)
```

- **Display server:** one Azure Container App (Consumption), always on for a real display, or scaling to zero between visits with a session time limit for a demo ([ADR 0001](docs/decisions/0001-container-apps.md), [ADR 0003](docs/decisions/0003-demo-scale-to-zero.md)).
- **Lightning ingest:** a Flex Consumption Function App, a storage account with keys disabled (everything uses managed identities), and the AWS relay ([ADR 0004](docs/decisions/0004-webhook-ingest-table-storage.md)).
- **Monitoring:** a Log Analytics workspace (30-day retention, small daily cap) and Application Insights.
- **Optional:** a free managed certificate for a custom domain, the GitHub OIDC deploy identity, and a budget alert.

[deploy.yml](.github/workflows/deploy.yml) publishes each image to GitHub Container Registry and deploys the container and the function.

## Sounds
The sirens and the all-clear chime are generated in code by a script in this repo. The spoken announcements use the voice "Brian" from [ElevenLabs](https://elevenlabs.io), recorded in advance. The display plays them with the Web Audio API and never calls ElevenLabs. If a clip cannot load, the browser's own voice reads the same sentence.

## Project layout
- `src/server/`: the Fastify server (`/health`, the push channel, the weather relay). Also:
  - `glm/` reads GOES-19 GLM files;
  - `sns/` verifies SNS signatures;
  - `strikes/` stores and queries flashes;
  - `ingest/` handles notifications;
  - `push/` streams nearby flashes to displays;
  - `weather/` relays api.weather.gov with the required User-Agent, cached and retried politely.
- `src/functions/`: the Azure Function entry point for lightning ingest.
- `src/shared/`: code for both server and browser (great-circle distance, grid cells, message and weather shapes).
- `src/client/`: the browser display and the location picker (`location.html`), built with Vite. `stream.ts` is the push channel client. `display-settings.ts` picks the point the display watches: `?lat&lon` in the address, else the location saved by the picker (`location-settings.ts`). `display-controller.ts` runs the state machine (`src/shared/display-state.ts`) for the page. `audio.ts` plays the sirens and announcements. `alert-settings.ts` keeps the sound, countdown, clock and temperature settings. `weather-panel.ts` shows the weather for the point.
- `test/`: Vitest tests.
- `scripts/audio/`: the scripts that make the sounds ([audio plan](docs/audio-plan.md)).
- `assets/`: the logo. `logo.svg` is the app icon and favicon, `logo-mark.svg` has a transparent background, and both have PNG copies. The `-yellow` files are an alternate colourway that isn't in use. `assets/audio/` holds the sirens, the chime and the announcements.
- `docs/`: the [system design](docs/system-design.md), the [plan](docs/plan.md), and decisions in [docs/decisions](docs/decisions/).
- `infra/`: Bicep and the deploy guide. `infra/aws/` holds the CloudFormation relay.
- `.github/workflows/`: pull request checks and the deploy.
