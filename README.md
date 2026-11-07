# OpenPodcast API

[![Docker Pulls](https://img.shields.io/docker/pulls/openpodcast/api?color=%23099cec&logo=Docker)](https://hub.docker.com/r/openpodcast/api)

This thin API layer is used to store `POST`ed payloads to the main storage system of Open Podcast.

## Getting Started

-   Run `make install-init`
-   Start dev server with `make dev`
-   Create `.env` file based on `env.example` and change the credentials to access the database. For a docker compose setup have a look at [https://github.com/openpodcast/stack](https://github.com/openpodcast/stack)
-   In a new window, run e.g. `make send-api-req-local` to send a test request to the local dev server (result is stored to DB).

### Connector Format

```javascript
{
    "provider": "spotify",
    "version": 1,
    "retrieved": "<timestamp ISO 8601>", //2022-07-21T09:35:31.820Z
    "meta": {
        "show": "<spotify_show_id>",
        "episode": null || "<episode_id>",
        "endpoint": "<endpoint_name>", // e.g. aggregate
    },
    "range": {
        "start": "<date>", //2022-01-01
        "end": "<date>"
    },
    "data": <raw_json>
}
```

### Feedback API (thumbs up/down)

The feedback API retrieves thumbs up/down votes from listeners.
It stores one unique vote for each episode per IP and user-agent pair.

Endpoint `/feedback/:episodeID/[upvote|downvote]`
e.g. `/feedback/123456/upvote`

### Authentication and analytics

`ACCOUNTS` (or `ACCOUNTS_FILE`) must be a nonempty JSON object mapping nonempty,
whitespace-free bearer tokens to positive integer account IDs (1–2147483647).
Invalid maps fail startup without including credentials in the error. Use
`Authorization: Bearer <token>` on protected requests.

`GET /analytics/v1/<query>` uses the authenticated account for every contributing
row, join and latest-date calculation. Query names remain restricted to loaded
SQL files; there is no client-supplied SQL or account override. The shipped
`ping` query returns `[{"result":"Pong"}]` without reading tenant data. Custom
query files must accept one bound `?` account ID and scope all tenant reads to it.

### Status API

`GET /status` requires bearer authentication and no request body. It returns only
the caller's account, keyed by ID, with endpoint update times in ISO 8601 format:

```json
{"1":{"latestUpdates":{"aggregate":"2026-01-01T00:00:00.000Z"}}}
```

An account with no updates receives `{}`. Monitoring clients must supply their
account's bearer token (`make status` reads `TOPP_API_TOKEN` from the environment).
`GET /health` remains public and reports only service
health booleans, never account IDs or import timestamps.

### Development checks

Run `npm ci --ignore-scripts`, `npm run lint`, and `npm test` (TypeScript build,
existing performance tests and in-process Supertest security regressions).
`createApp` constructs production routing without opening a listener or reading
application configuration, so tests inject only synthetic services.

Run `npm run test:mysql` with `TEST_MYSQL_URL` pointing at a **disposable MySQL 8**
server, for example `mysql://root@127.0.0.1:3306`. The test account needs permission
to create/drop databases. The suite creates a random `topp_synthetic_*` database,
loads only the necessary table definitions, inserts synthetic records with shared
episode IDs/titles across accounts, and drops its database after testing. It does
not read application database settings. GitHub Actions runs these same checks on
branch pushes, without deployments or image publishing.

Legacy `make e2e-tests` expects a separately running API/database and its own auth
configuration; it is not part of the isolated default test command. Never point
it at a production service or load private payloads for regression tests.

The existing dependency graph has separately reported runtime and development
security advisories. These focused application fixes do not refresh dependencies
or establish an audit-clean baseline. Review with
`npm audit --package-lock-only --ignore-scripts` (and `--omit=dev` for runtime).

### Tools to create (JSON) schemata

- <https://transform.tools/json-to-json-schema>
