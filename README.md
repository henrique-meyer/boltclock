# boltclock
Full-screen lightning alarm for any location. When NOAA satellite data shows a strike within your radius, it sounds a siren, calls out the distance, and runs an all-clear countdown, with live weather readable from across the room.

## Hosting
BoltClock runs as one always-on container. The reference deployment is Azure Container Apps in a single resource group. Resource names, the subscription and any custom domain stay out of this repo. [infra/README.md](infra/README.md) lists each resource's settings and the deploy steps, and [ADR 0001](docs/decisions/0001-container-apps.md) explains the choice.

- A Log Analytics workspace (30-day retention, small daily cap)
- A Container Apps environment (Consumption) and one container app with a single always-on replica
- Optional: a managed certificate for a custom domain, a GitHub OIDC deploy identity, and a budget alert

Images are published to GitHub Container Registry by [deploy.yml](.github/workflows/deploy.yml).
