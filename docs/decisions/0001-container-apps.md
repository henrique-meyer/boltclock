# Container Apps

BoltClock runs as one container on Azure Container Apps, Consumption profile, with exactly one replica that never scales to zero. The lightning ingest polls the NOAA GOES-19 bucket around the clock, and the display holds a push connection open, so there is no idle period to save money on. A second replica would only ingest the same data twice.

The region is East US, the same metro as the NOAA bucket in AWS us-east-1, which keeps the 20–60 second GLM delay from growing. The container keeps no state on disk: on start it rebuilds the last 60 minutes of flashes from the bucket. No storage account, database or volume is needed.

Images are published to GitHub Container Registry as a public package, so the app needs no registry password. GitHub Actions deploys with OIDC through a user-assigned identity that can change only the container app. Custom domains use a free managed certificate.

The ingress has a 240-second request timeout, and Microsoft's documents disagree on whether it is an idle limit or a total one. The push channel is designed for either: a heartbeat every ~15 seconds, automatic reconnect in the browser, and a buffer replay on connect.

App Service B1 would cost about the same and also works. Container Apps fits a container-first repo better, with revisions, secrets and probes built in. Container Instances has no managed TLS for a custom domain, and AKS is more than one container needs.
