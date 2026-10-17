# Demo deployments scale to zero

ADR 0001 keeps one replica running around the clock, because a real display is watched all the time and the server ingests lightning data for it continuously. A hosted demo is different: people open it for a few minutes and leave. Kept always on, it would cost about $14 to $19 a month for a page that is mostly unwatched.

A demo deployment therefore sets `minReplicas = 0`. Container Apps stops the replica when no request has been open for its cooldown period (five minutes by default), and an HTTP scale rule starts it again on the next request. A display's push stream is an open request, so the replica stays up while someone watches.

To make sure an open display tab cannot keep the demo running forever, the server ends each display session after `SESSION_LIMIT_MINUTES` minutes (set through the `sessionLimitMinutes` parameter). It closes the stream with a "session ended" event. The display then stops reconnecting and goes back to its Start screen, which says the session has ended; pressing Start display reconnects. A session that has ended shows the data as stale and never announces all-clear, the same rule as any other loss of data. `0` means no limit.

Nothing else changes. The server is still stateless: a cold start rebuilds the last 60 minutes of flashes from the GLM bucket. The display shows "NO LIGHTNING DATA" until that finishes, which takes several seconds after the replica starts. There is still at most one replica.

Cost: the monthly Consumption free grant covers about 200 replica-hours at 0.25 vCPU / 0.5 GiB. With a 15-minute session limit and the five-minute cooldown, each visit uses about 20 minutes, so a demo stays free for roughly 600 visits a month. Crawlers that request the page also wake it, for about five minutes each.

A deployment for a real display keeps `minReplicas = 1` and `sessionLimitMinutes = 0`, as in ADR 0001.
