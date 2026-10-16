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

Open http://localhost:5173. Vite serves the client and forwards `/health` and the API to the server on port 8080. Fill in `.env` first: an identifying `NWS_USER_AGENT`, and your own `GOOGLE_MAPS_API_KEY` restricted to `http://localhost:5173/*` and `http://localhost:8080/*` (see [infra/README.md](infra/README.md)).

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

Checks: `npm run lint`, `npm run typecheck` and `npm test`. The stack (Node and TypeScript, Fastify, Vite, Vitest) is explained in [ADR 0002](docs/decisions/0002-node-typescript.md).

## Data and credits
- Lightning: NOAA GOES-19 Geostationary Lightning Mapper (GLM-L2-LCFA), public domain, from NOAA Open Data on AWS. No account needed.
- Weather: the National Weather Service API (api.weather.gov).
- Maps: Google Maps Platform, with Google's attribution kept on the map. Each deployer supplies their own key; none is in this repository.

## Hosting
BoltClock runs as one always-on container. The reference deployment is Azure Container Apps in a single resource group. Resource names, the subscription and any custom domain stay out of this repo. [infra/README.md](infra/README.md) lists each resource's settings and the deploy steps, and [ADR 0001](docs/decisions/0001-container-apps.md) explains the choice.

- A Log Analytics workspace (30-day retention, small daily cap)
- A Container Apps environment (Consumption) and one container app with a single always-on replica
- Optional: a managed certificate for a custom domain, a GitHub OIDC deploy identity, and a budget alert

Images are published to GitHub Container Registry by [deploy.yml](.github/workflows/deploy.yml).

## Sounds
The sirens and the all-clear chime are generated in code by a script in this repo. The spoken announcements use a voice from [ElevenLabs](https://elevenlabs.io).

## Project layout
- `src/server/`: the Fastify server (`/health` now; lightning ingest, push channel and weather relay to come).
- `src/client/`: the browser display, built with Vite.
- `test/`: Vitest tests.
- `scripts/audio/`: the scripts that make the sounds ([audio plan](docs/audio-plan.md)).
- `assets/`: the logo. `logo.svg` is the app icon and favicon, `logo-mark.svg` has a transparent background, and both have PNG copies. The `-yellow` files are an alternate colourway that isn't in use. `assets/audio/` holds the sirens, the chime and the announcements.
- `docs/`: the [system design](docs/system-design.md), the [plan](docs/plan.md), and decisions in [docs/decisions](docs/decisions/).
- `infra/`: Bicep and the deploy guide.
- `.github/workflows/`: pull request checks and the deploy.
