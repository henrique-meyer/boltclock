# Cloud infrastructure

BoltClock runs as one always-on container on Azure Container Apps. The definition is Bicep in [`main.bicep`](main.bicep). Why Container Apps, and why one replica that never scales to zero: [ADR 0001](../docs/decisions/0001-container-apps.md).

Run commands from the repository root. Keep resource names, the subscription, tenant and client IDs, the domain, emails and keys in ignored files (`infra/main.bicepparam`, `.env`) or in GitHub secrets. Preview with `what-if` and get the owner's approval before provisioning anything that costs money.

## Resources

One resource group, one region. East US is the default because the NOAA GOES bucket is in AWS us-east-1, in the same metro.

| Resource | Settings | Purpose |
| --- | --- | --- |
| Log Analytics workspace | PerGB2018, 30-day retention, 0.1 GB/day cap | Container and system logs |
| Container Apps environment | Workload profiles, Consumption profile only, no VNet | Hosts the app |
| Container app | External HTTPS ingress (HTTP redirects), target port 8080, 0.25 vCPU / 0.5 GiB, min and max 1 replica, single revision mode, startup/readiness/liveness probes on `/health` | Serves the display, the push channel and the weather relay |
| Container Apps secret `google-maps-api-key` | Set from `GOOGLE_MAPS_API_KEY` at deploy time | The deployer's browser key for Google Maps |
| Managed certificate (optional) | Free, bound once with the CLI | HTTPS on a custom domain |
| User-assigned identity + federated credential (optional) | Reader on the group, Contributor on the container app | GitHub Actions deploys with OIDC, with no stored Azure credentials |
| Budget (optional) | Alerts at 80% actual and 100% forecast | Cost guard; the deployer picks the amount |

The image comes from GitHub Container Registry as a public package, so the app needs no registry credentials.

## Container contract

- Listens on `PORT` (8080).
- `GET /health` answers `200 {"status":"ok"}` as soon as the process is up. It never depends on NOAA data freshness: stale lightning data is a warning on the display, not a reason to restart the container.
- Reads `GOOGLE_MAPS_API_KEY`, `NWS_USER_AGENT` and `PUBLIC_BASE_URL` from the environment.
- Keeps no state on disk. On start it rebuilds the last 60 minutes of flashes from the GLM bucket, so restarts and new revisions lose nothing.
- Logs to stdout. It never logs addresses or search text.
- The ingress has a 240-second request timeout. The push channel sends a heartbeat every ~15 seconds, the browser reconnects when a stream drops, and the server replays its buffer on connect (flashes are deduplicated by id).

## Cost

Checked 2026-10-16 against the Azure retail prices API (East US, Consumption): active vCPU $0.000024/s, memory $0.000003/GiB·s, and a monthly free grant of 180,000 vCPU·s and 360,000 GiB·s per subscription. One always-on 0.25 vCPU / 0.5 GiB replica is about $14 a month if the free grant is otherwise unused, and about $19 without it. An open display connection keeps the replica at the active rate. Log Analytics ingestion is free for the first 5 GB a month. Check current prices before you deploy.

## Load the secrets

`main.bicepparam` reads `GOOGLE_MAPS_API_KEY` and `NWS_USER_AGENT` from the environment, so the values never sit in a parameter file. Load `.env` into the shell first.

```powershell
Get-Content .env | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  Set-Item "env:$($name.Trim())" $value.Trim()
}
```

```bash
while IFS='=' read -r name value; do
  [[ $name =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && export "$name=$value"
done < .env
```

## First deploy

Copy `infra/main.bicepparam.example` to `infra/main.bicepparam` and fill in the names. Keep `deployApp = false`: no image exists yet. This creates the workspace, the environment and the deploy identity.

```powershell
$env:AZURE_RESOURCE_GROUP = '<resource-group>'
az group create --name $env:AZURE_RESOURCE_GROUP --location eastus
az bicep build --file infra/main.bicep --stdout > $null
az deployment group what-if --resource-group $env:AZURE_RESOURCE_GROUP --template-file infra/main.bicep --parameters infra/main.bicepparam
az deployment group create --resource-group $env:AZURE_RESOURCE_GROUP --template-file infra/main.bicep --parameters infra/main.bicepparam
```

## GitHub deploy

Create a GitHub environment named `production` and add these Actions secrets to it:

- `AZURE_CLIENT_ID`: the `deployIdentityClientId` deployment output
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP`
- `AZURE_CONTAINERAPP_NAME`

Set `githubFederationSubject` to the exact subject GitHub emits for that environment. It may include immutable IDs, for example `repo:<owner>@<owner-id>/<repo>@<repo-id>:environment:production`. If `azure/login` fails with `AADSTS700213`, the subject is wrong: copy the subject from the error into the parameter file and deploy again.

[`deploy.yml`](../.github/workflows/deploy.yml) runs on every push to `main`. It pushes `ghcr.io/<owner>/boltclock` tagged `sha-<commit>` and `prod`, then updates the container app to the commit tag. It skips the build until a `Dockerfile` exists and skips Azure until the secrets are set.

## Turn the app on

1. After the first `deploy.yml` run publishes the image, make the package public: package settings, Danger Zone, Change visibility, Public. It is a one-time UI action with no API, and it cannot be undone. A public package still answers 401 to a manifest request without a token, so a raw 401 does not mean it is private.
2. Set `deployApp = true` and `containerImage = 'ghcr.io/<owner>/boltclock:prod'`, then preview and deploy as above.
3. Check the revision and the health endpoint:

```powershell
az containerapp revision list --resource-group $env:AZURE_RESOURCE_GROUP --name <app> --query "[].{name:name, running:properties.runningState, health:properties.healthState}" --output table
curl.exe https://<containerAppFqdn>/health
```

"Successfully pulled image" in the log does not mean the site is up. Traffic moves only once a revision is healthy.

## Custom domain and HTTPS

1. The deployment outputs `containerAppFqdn` and `customDomainVerificationId`. At your DNS provider add a CNAME from your hostname to `containerAppFqdn`, and a TXT record `asuid.<hostname>` with `customDomainVerificationId`. Keep the real records in your local notes.
2. Add the hostname and bind a free managed certificate:

```powershell
az containerapp hostname add --resource-group $env:AZURE_RESOURCE_GROUP --name <app> --hostname <hostname>
az containerapp hostname bind --resource-group $env:AZURE_RESOURCE_GROUP --name <app> --environment <environment> --hostname <hostname> --validation-method CNAME
az containerapp env certificate list --resource-group $env:AZURE_RESOURCE_GROUP --name <environment> --managed-certificates-only --query "[].{id:id, subject:properties.subjectName}" --output table
```

3. Put `customDomainName`, `customDomainCertificateId` and `publicBaseUrl` in the private parameter file. Without them, the next Bicep deploy removes the binding.
4. Restrict the Google Maps key: HTTP referrer `https://<hostname>/*`, APIs Maps JavaScript API and Places API (New). Use a separate key for `http://localhost:8080/*`.

## Operations

- Logs: `az containerapp logs show --resource-group $env:AZURE_RESOURCE_GROUP --name <app> --follow`
- `az containerapp update` with an unchanged image string does not create a revision. CI deploys the commit tag, so each run is a new string. To restart on the same image, pass `--revision-suffix`.
- A revision that failed to activate stays failed. Create a new one rather than restarting it.

## Teardown

```powershell
az group delete --name $env:AZURE_RESOURCE_GROUP
```

This deletes every Azure resource above. The GHCR package and your DNS records are separate.
