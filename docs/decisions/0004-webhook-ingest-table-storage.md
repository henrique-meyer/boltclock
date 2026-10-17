# Lightning ingest by push, flashes in Table Storage

NOAA publishes an SNS topic, `arn:aws:sns:us-east-1:123901341784:NewGOES19Object`, that announces every new object in the GOES-19 bucket. BoltClock takes its lightning data from these notifications instead of polling the bucket, and one ingest serves every display.

## Path: NOAA SNS → AWS Lambda relay → Azure Function

The topic accepts only Lambda and SQS subscribers ("only Lambda and SQS protocols allowed", on NOAA's entry in the Registry of Open Data on AWS), so it cannot post to Azure directly. A tiny relay Lambda in the deployer's AWS account, in us-east-1 next to the topic, is subscribed instead. Its filter policy on the message body passes only `GLM-L2-LCFA/` keys, about three notifications a minute. The relay POSTs each SNS record, unchanged, to the ingest Function in Azure. It is defined in [`infra/aws/relay.yaml`](../../infra/aws/relay.yaml) and unit-tested by running its inline code.

The receiver is a small Azure Function on the Flex Consumption plan, not the container app. A GLM file arrives every 20 seconds, so delivering into the container would keep a scale-to-zero demo (ADR 0003) awake around the clock. The Function is billed per execution and costs nothing between calls.

The forwarded record still carries NOAA's original SNS signature, and the Function verifies it before doing anything else:

- the topic must be NOAA's;
- the signing certificate must come over HTTPS from an `sns.<region>.amazonaws.com` host;
- the RSA signature (SHA1 or SHA256, by `SignatureVersion`) must match the documented string to sign;
- messages older than an hour are refused.

So the Function trusts NOAA, not the relay or whoever can reach its URL, and anything else gets 403. No credentials cross between the clouds: the relay may only write its own logs, and the Function needs nothing from AWS. Replaying a genuine message only rewrites the same rows.

For a notification, the Function downloads each announced file from the public bucket, parses it (`src/server/glm/parse.ts`), and stores the flashes. A 5xx or 429 answer makes the relay throw, and Lambda then retries the event twice. A notification that still fails is dropped, and the display shows "NO LIGHTNING DATA" for that gap, as it would for any outage.

An SNS → SQS queue read on a timer was also considered. A queue would buffer through an Azure outage, but it is polling again and needs AWS credentials stored in Azure.

## Storage

Flashes go into Azure Table Storage, one row per flash:

- one table per UTC hour of the flash time, e.g. `glm2026101715`;
- PartitionKey: the 1° latitude/longitude cell of the flash, e.g. `28_-82`;
- RowKey: the flash time as sortable UTC text plus the flash id, e.g. `20261017T153021.437Z_00412`. A replayed notification writes the same rows again.

A file brings a few hundred flashes across one to two hundred cells, with fewer than 100 in a cell (measured in [glm-format.md](../glm-format.md)), so each touched cell is one batch transaction. After the flashes, the Function raises a single status row with the newest file end time. An ETag check means it never moves backwards. The display's "NO LIGHTNING DATA" check reads that row.

To find strikes within R of a point in the last T minutes, a reader works out which cells the circle overlaps (allowing for the poles and the antimeridian), runs one range query per cell and per hourly table (`PartitionKey eq cell and RowKey ge since`), then keeps the flashes within the exact great-circle distance. T is the display's time limit, 30 minutes by default and at most 120.

Data is kept for 120 minutes. At most every five minutes, while it writes, the Function deletes the hourly tables that hold nothing newer than that. One call removes an hour, there is no background service, and readers always filter by time, so a table deleted late never causes an alert.

Table Storage has no geospatial query, so the grid cells in the PartitionKey stand in for a spatial index. Databases with real spatial queries were considered and set aside on cost. Azure SQL's `geography` type would answer the query directly, but writes every 20 seconds keep a serverless database from pausing, and its free allowance would be gone in days. Cosmos DB has `ST_DISTANCE` and automatic TTL, but it is free only through the one free-tier account a subscription gets, which this project should not take, and it costs tens of dollars a month otherwise. Blob Storage, one blob per file, would need a listing and a download per file for every query.

## Cost

About 130,000 relay invocations and Function executions a month, and roughly 14 million table transactions (one per touched cell per file). Each comes to cents, or at most a few dollars, at current prices. Storage is a few megabytes. The relay's logs are kept for one day. Nothing here uses a one-per-subscription free offer.
