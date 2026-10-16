# Tech recommendations: OPTIONAL suggestions only
Claude/the implementer picks the stack. These are ideas, not requirements.

- **Ingest/server:** Python 3.12 + FastAPI, `netCDF4`/`xarray` for GLM NetCDF4, `boto3` anonymous (UNSIGNED) S3 access. Node alternative: `h5wasm` (works, rougher edges).
- **Push:** Server-Sent Events (simple, auto-reconnect), or WebSocket.
- **New-file detection:** poll the S3 listing of the current hour prefix every ~10 s (no AWS account needed), or subscribe an SQS queue/Lambda/HTTPS endpoint to SNS `NewGOES19Object` (needs an AWS account). Run in us-east-1 for the lowest latency.
- **Client:** TypeScript + Vite (vanilla or React). The map is required to be Google Maps (JS API + Places). Consider `@googlemaps/js-api-loader`, an AdvancedMarker with `gmpDraggable`, and the Places Autocomplete widget. Load the key from runtime config.
- **Optional no-key fallback idea (not in spec):** if no Google key is configured, a plain lat/lon entry field, or Leaflet/OSM with Nominatim (≤1 req/s, attribution).
- **Audio:** Web Audio API oscillators for the siren/chime. Pre-recorded speech clips (0–100 + phrases) generated once with Piper TTS (open source), with Web Speech API as the fallback. Freesound CC0 as an optional sample source.
- **Hosting:** Docker on a Raspberry Pi/mini PC running Chrome `--kiosk --autoplay-policy=no-user-gesture-required`, or Fly.io/Render/a small VPS, or AWS Lambda + SQS.
- **Testing:** pytest/Vitest. Save a sample GLM file as a fixture.
