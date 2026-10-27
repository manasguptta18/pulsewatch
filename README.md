# PulseWatch

Distributed API uptime and latency monitoring platform.

## Run the backend in production

Use Node.js with the backend dependencies installed. From `backend/`, run:

```text
npm ci
npm exec -- prisma generate
npm run build
npm run start
```

Run the monitor-check and notification-outbox worker as a **separate process** from
the same build and environment:

```text
cd backend
npm run start:worker
```

The API process schedules checks into BullMQ; the worker executes them and sends
queued notifications. Both processes need PostgreSQL and Redis access. The worker
must be running for scheduled checks and email delivery. `npm run dev` and
`npm run dev:worker` are local development commands.

## Configuration

Set these variables in the deployment environment or its secret manager. Do not
commit credentials or deployment `.env` files.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | API, worker, Prisma CLI | PostgreSQL connection URL |
| `REDIS_URL` | API, worker | Redis connection URL for BullMQ and Socket.IO |
| `JWT_SECRET` | API | JWT signing secret, at least 32 UTF-8 bytes |
| `FRONTEND_ORIGIN` | API | Exact browser origin for HTTP and Socket.IO CORS; comma-separated origins are supported |
| `PORT` | API | HTTP port; defaults to `3000` |
| `TRUST_PROXY_HOPS` | API | Trusted reverse-proxy hop count; defaults to `0` |
| `MONITOR_WORKER_CONCURRENCY` | Worker | Concurrent monitor jobs, `1`–`32`; defaults to `5` |
| `RESEND_API_KEY` | Worker | Resend credential for incident email |
| `RESEND_FROM_EMAIL` | Worker | Sender address verified for the Resend account |
| `OLLAMA_HOST` | API | Ollama server URL if it is not running at the SDK default location |
| `VITE_API_BASE_URL` | Frontend build | Full API base URL when the API is on a separate origin |

Build the frontend from `frontend/` with `npm ci` and `npm run build`, then serve
`frontend/dist` with single-page-app route fallback. The production frontend
defaults to the same-origin `/api/v1` API path. For that layout, the web server
must proxy `/api/v1` and `/socket.io` (including WebSocket upgrades) to the API.
For a separate API origin, set `VITE_API_BASE_URL` to that origin plus `/api/v1`
**before building**, and set `FRONTEND_ORIGIN` to the frontend's exact origin.

The AI summary route uses the `qwen3:8b` model through Ollama. Deploy an Ollama
service with that model if AI summaries are required. Incident email requires a
working Resend key and a verified sender; the SDK test sender is unsuitable for
general production recipients.

## Migration and health checks

From `backend/`, inspect migration status without changing data:

```text
npm exec -- prisma migrate status
```

After reviewing the target database, migration SQL, and backup plan, apply
pending migrations with `npm exec -- prisma migrate deploy` as a separate,
approved deployment step. Never use a reset or seed command on production data.
`GET /health/live` reports whether the API process is running.
`GET /health/ready` checks PostgreSQL and Redis and returns `503` while either is
unavailable. Readiness does not confirm that the separate worker is processing
jobs; check its process health and job activity separately.
