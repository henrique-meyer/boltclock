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

Checks: `npm run lint`, `npm run typecheck` and `npm test`.

## Data and credits
- Lightning: NOAA GOES-19 Geostationary Lightning Mapper (GLM-L2-LCFA), public domain, from NOAA Open Data on AWS. No account needed.
- Weather: the National Weather Service API (api.weather.gov).
- Maps: Google Maps Platform, with Google's attribution kept on the map. Each deployer supplies their own key; none is in this repository.

## Tech stack
- **Language and runtime:** TypeScript on Node 24 LTS for the server, the ingest function and the browser client ([ADR 0002](docs/decisions/0002-node-typescript.md)).
- **Server:** Fastify, serving the display, `/health`, the push channel (server-sent events at `/api/stream`) and, as it lands, the weather relay.
- **Client:** Vite and plain TypeScript, with no UI framework.
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

## Project layout
- `src/server/`: the Fastify server (`/health`, the push channel; the weather relay to come). Also:
  - `glm/` reads GOES-19 GLM files;
  - `sns/` verifies SNS signatures;
  - `strikes/` stores and queries flashes;
  - `ingest/` handles notifications;
  - `push/` streams nearby flashes to displays.
- `src/functions/`: the Azure Function entry point for lightning ingest.
- `src/shared/`: code for both server and browser (great-circle distance, grid cells).
- `src/client/`: the browser display, built with Vite. `stream.ts` is the push channel client. Until the settings screen exists, the point comes from the address: `?lat=…&lon=…&radius=10&unit=mi&minutes=30`.
- `test/`: Vitest tests.
- `assets/`: the logo. `logo.svg` is the app icon and favicon, `logo-mark.svg` has a transparent background, and both have PNG copies. The `-yellow` files are an alternate colourway that isn't in use.
- `docs/`: the [system design](docs/system-design.md), the [plan](docs/plan.md), and decisions in [docs/decisions](docs/decisions/).
- `infra/`: Bicep and the deploy guide. `infra/aws/` holds the CloudFormation relay.
- `.github/workflows/`: pull request checks and the deploy.
