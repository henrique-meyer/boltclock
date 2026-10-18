# Cloud infrastructure

BoltClock runs as one container on Azure Container Apps. The definition is Bicep in [`main.bicep`](main.bicep). Why Container Apps, and why a display deployment keeps one replica always on: [ADR 0001](../docs/decisions/0001-container-apps.md). Why a demo deployment scales to zero instead: [ADR 0003](../docs/decisions/0003-demo-scale-to-zero.md).

Run commands from the repository root. Keep resource names, the subscription, tenant and client IDs, the domain, emails and keys in ignored files (`infra/main.bicepparam`, `.env`) or in GitHub secrets. Preview with `what-if` and get the owner's approval before provisioning anything that costs money.

## Resources

One resource group, one region. East US is the default because the NOAA GOES bucket is in AWS us-east-1, in the same metro.

| Resource | Settings | Purpose |
| --- | --- | --- |
| Log Analytics workspace | PerGB2018, 30-day retention, 0.1 GB/day cap | Container and system logs |
| Container Apps environment | Workload profiles, Consumption profile only, no VNet | Hosts the app |
| Container app | External HTTPS ingress (HTTP redirects), target port 8080, 0.25 vCPU / 0.5 GiB, at most 1 replica (minimum 1 for a display, 0 for a demo) with an HTTP scale rule, single revision mode, startup/readiness/liveness probes on `/health` | Serves the display, the push channel and the weather relay |
| Container Apps secret `google-maps-api-key` | Set from `GOOGLE_MAPS_API_KEY` at deploy time | The deployer's browser key for Google Maps |
| Managed certificate (optional) | Free, bound once with the CLI | HTTPS on a custom domain |
| User-assigned identity + federated credential (optional) | Reader on the group, Contributor on the container app | GitHub Actions deploys with OIDC, with no stored Azure credentials |
| Budget (optional) | Alerts at 80% actual and 100% forecast | Cost guard; the deployer picks the amount |

The image comes from GitHub Container Registry as a public package, so the app needs no registry credentials.

## Container contract

- Listens on `PORT` (8080).
- `GET /health` answers `200 {"status":"ok"}` as soon as the process is up. It never depends on NOAA data freshness: stale lightning data is a warning on the display, not a reason to restart the container.
- Reads `GOOGLE_MAPS_API_KEY`, `NWS_USER_AGENT`, `PUBLIC_BASE_URL`, `SESSION_LIMIT_MINUTES` and `STRIKES_TABLE_ENDPOINT` from the environment. With the endpoint set, it reads the flash tables with its managed identity; without it, `/api/stream` answers 503.
- With `SESSION_LIMIT_MINUTES` above 0, ends each display session after that many minutes, so a demo can scale back to zero.
- With `BUTTON_ICONS_ONLY=true` (Bicep `buttonIconsOnly`, default `false`), the display's top-right buttons show only their icons; otherwise each icon has its label.
- With `GA_MEASUREMENT_ID` set (Bicep `gaMeasurementId`, default empty), the display and the location picker load Google Analytics 4. The page address sent to Google drops its query string (no coordinates), and Google signals and ad personalization are off.
- With `ALLOW_SIMULATION=true` (Bicep `allowSimulation`, default `false`), each display's settings offer a Simulation mode checkbox: "Simulate a strike" and, during a countdown, "Simulate all clear", for demos. Simulated strikes are local to the browser tab and never stored. Without it there is no checkbox and no Simulate buttons.
- `TEST_MODE=true` (Bicep `testMode`, default `false`) makes Simulation mode on by default; each device can turn it off or on, and its choice is saved on that device.
- Keeps no state on disk. On start it rebuilds the last 60 minutes of flashes from the GLM bucket, so restarts and new revisions lose nothing.
- Logs to stdout. It never logs addresses or search text.
- The ingress has a 240-second request timeout. The push channel (`GET /api/stream`) reads the flash tables and sends a heartbeat every ~15 seconds. The browser reconnects when a stream drops, the server replays the display's window on connect, and flashes are deduplicated by id. On shutdown the server closes open streams, so a new revision starts promptly.

## Cost

Checked 2026-10-16 against the Azure retail prices API (East US, Consumption): active vCPU $0.000024/s, memory $0.000003/GiB·s, and a monthly free grant of 180,000 vCPU·s and 360,000 GiB·s per subscription. One always-on 0.25 vCPU / 0.5 GiB replica is about $14 a month if the free grant is otherwise unused, and about $19 without it. An open display connection keeps the replica at the active rate. Log Analytics ingestion is free for the first 5 GB a month. Check current prices before you deploy.

A demo with `minReplicas = 0` pays only while a replica runs: the free grant covers about 200 replica-hours a month at this size. With `sessionLimitMinutes = 15` and the five-minute scale-down cooldown, a visit uses about 20 minutes, so a lightly used demo costs nothing. The first request after an idle period waits for the replica to start, and the display shows "NO LIGHTNING DATA" until the server has rebuilt its 60-minute buffer.

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
2. Set `deployApp = true` and `containerImage = 'ghcr.io/<owner>/boltclock:prod'`. For a demo, also set `minReplicas = 0` and a short `sessionLimitMinutes` ([ADR 0003](../docs/decisions/0003-demo-scale-to-zero.md)). Then preview and deploy as above.
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
4. Restrict the Google Maps key: HTTP referrer `https://<hostname>/*`, APIs Maps JavaScript API and Places API (New). Use a separate key for local work, restricted to `http://localhost:5173/*` (`npm run dev`) and `http://localhost:8080/*`.

## Lightning ingest

NOAA's GOES-19 SNS topic, an AWS Lambda relay and an Azure Function feed the flash tables ([ADR 0004](../docs/decisions/0004-webhook-ingest-table-storage.md)). There are two parts: Azure first, so the relay has somewhere to post.

### Azure

1. In the private parameter file set `deployIngest = true` and the globally unique `ingestStorageAccountName` and `ingestFunctionAppName`, then preview and deploy as above. This creates:
   - a storage account with shared keys disabled;
   - a Flex Consumption plan and Function App (Node 24, at most `ingestMaxInstances` instances);
   - Application Insights on the existing workspace;
   - these role assignments:
     - the Function App's identity: Storage Blob Data Owner and Storage Table Data Contributor on the account;
     - the container app, which now gets an identity: Storage Table Data Reader;
     - the deploy identity: Website Contributor on the Function App.
2. Add the Function App's name to the GitHub `production` environment as `AZURE_FUNCTIONAPP_NAME`. The next run of [`deploy.yml`](../.github/workflows/deploy.yml) packages and deploys the function. It then checks that an unsigned POST to `/api/glm` is refused with 403.
3. Note the `ingestWebhookUrl` deployment output: `https://<function-app>.azurewebsites.net/api/glm`.

### AWS

Copy `infra/aws/relay.parameters.example.json` to `infra/aws/relay.parameters.json` (ignored by git) and fill it in. `TargetUrl` is the `ingestWebhookUrl` from above. Then preview and deploy the stack in us-east-1:

```powershell
aws cloudformation create-change-set --region us-east-1 --stack-name <stack> --change-set-name preview --change-set-type CREATE --template-body file://infra/aws/relay.yaml --parameters file://infra/aws/relay.parameters.json --capabilities CAPABILITY_IAM --tags Key=Project,Value=<project-tag>
aws cloudformation describe-change-set --region us-east-1 --stack-name <stack> --change-set-name preview --query "Changes[].ResourceChange.{action:Action, type:ResourceType, id:LogicalResourceId}" --output table
aws cloudformation execute-change-set --region us-east-1 --stack-name <stack> --change-set-name preview
```

The stack holds:
- the relay function: Node 24, arm64, 128 MB;
- its role, which may only write its own logs;
- a log group kept for one day;
- the permission for NOAA's topic, and only that topic, to invoke the function;
- the filtered subscription;
- a tag-based Resource Group.

Lambda subscriptions need no confirmation step. Within a minute the function's Application Insights should show "Stored … flashes" about three times a minute.

To stop ingest, delete the stack. That removes the subscription. The Azure resources stay until you set `deployIngest = false`, or until teardown.

## Operations

- Logs: `az containerapp logs show --resource-group $env:AZURE_RESOURCE_GROUP --name <app> --follow`
- `az containerapp update` with an unchanged image string does not create a revision. CI deploys the commit tag, so each run is a new string. To restart on the same image, pass `--revision-suffix`.
- A revision that failed to activate stays failed. Create a new one rather than restarting it.

## Teardown

```powershell
az group delete --name $env:AZURE_RESOURCE_GROUP
```

This deletes every Azure resource above. The GHCR package and your DNS records are separate.
