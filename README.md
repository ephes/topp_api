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

Feedback remains public and stores one vote per episode and listener hash (IP
and user agent). `GET /feedback/:episodeId/upvote` or `downvote` only displays a
confirmation form. Crawlers, link previews, GET and HEAD never record a vote.
The form deliberately submits `POST /feedback/:episodeId/:feedbackType` to save
it. `POST /comments/:episodeId` accepts the rendered comment form.

Set **`PUBLIC_ORIGIN`** (or `PUBLIC_ORIGIN_FILE`) to the canonical external HTTP(S)
origin, e.g. `https://api.example.test`, with no trailing slash, path or credentials.
It is required at startup. Both vote and comment POSTs require a matching Origin
or `Sec-Fetch-Site: same-origin`; contradictory/cross-origin metadata is rejected
with 403. Host headers do not determine the allowed origin. Browser forms lacking
both headers are rejected. Existing feedback links now require confirmation;
update callers that previously relied on GET recording a vote.

Nonbrowser clients explicitly opt in using `Content-Type: application/json` and
`X-Feedback-Client: api`, with no Origin or Fetch Metadata headers. For example,
send `{}` to the vote URL or `{"email":"listener@example.test","comment":"Feedback"}`
to the comments URL. A custom header/JSON request requires a browser preflight
when cross-origin; the API does not grant cross-origin access. This boundary does
not provide bot authentication or rate limiting.

The listener hash uses Express's `req.ip`. **`TRUST_PROXY`** defaults to unset
(peer address only), so spoofed `X-Forwarded-For` headers have no effect. When
behind a proxy, set a comma-separated list of only trusted proxy IPs/CIDRs (or
Express's named subnets), e.g. `loopback,203.0.113.0/24`. The trusted edge must
replace untrusted forwarding headers. Avoid trusting every address; Express
stops at the first untrusted hop. `TRUST_PROXY_FILE` is also supported. IP and user
agent inputs are bounded to 128 and 512 characters before hashing; raw identity
material is neither stored by these handlers nor logged. Configure this policy
before adopting the change to preserve the intended per-listener vote identity.

### Error responses

Errors have stable, bounded plain-text bodies in development and production:
400 `Invalid request`, 401 `Not authorized`, 403 `Forbidden`, 404 `Not Found`,
413 `Request too large`, 415 `Unsupported media type`, and 500 `Internal server error`.
Protected requests authenticate before route lookup; malformed JSON/body-size
errors are handled before authentication. Unknown well-formed analytics names return 404; malformed version/query names
return 400. Database failures return 500. Logs contain fixed failure categories/statuses,
never exception text, SQL, credentials or submitted values. `/health` reports
only booleans even when its database check fails.

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
