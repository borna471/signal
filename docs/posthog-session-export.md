# PostHog Session Export for Replay Reconstruction

This repository now includes a backend recording extractor that uses your personal PostHog API key and exports replay-ready snapshot data.

## Backend separation

- Backend modules: `backend/posthog/config.mjs`, `backend/posthog/client.mjs`, `backend/posthog/exporter.mjs`
- CLI wrapper (thin): `scripts/export-posthog-recordings.mjs`
- Backend API route: `app/api/posthog/export/route.js`

## Run

```bash
npm run export:recordings -- --limit 20 --out-dir data/posthog-export
```

## Run via backend API

```bash
curl -X POST http://localhost:3000/api/posthog/export \
  -H "Content-Type: application/json" \
  -d '{"limit":20,"outDir":"data/posthog-export"}'
```

Optional flags:

- `--recording-id <id>`: export exactly one recording.
- `--project-id <id>`: override project auto-detection.
- `--api-host <url>`: override API host (defaults from `NEXT_PUBLIC_POSTHOG_HOST`).
- `--since <date>`: pass `date_from` to recordings API (example: `-7d`, `2026-02-01`).
- `--page-size <n>`: recording list page size.
- `--blob-batch-size <n>`: how many contiguous blob keys to fetch per request.
- `--include-ongoing`: include currently recording sessions.

## Required env

- `POSTHOG_PERSONAL_KEY` (or `POSTHOG_PERSONAL_API_KEY`)
- If omitted from shell env, the script will read `.env.local`.

## Output structure

- `data/posthog-export/manifest.json`
- `data/posthog-export/<recording-id>/sources.json`
- `data/posthog-export/<recording-id>/events-<start>-<end>.ndjson`
- `data/posthog-export/<recording-id>/event-summary.json`

## Why this is replay/vision ready

- Exports raw rrweb-style timeline events from PostHog snapshot blobs (`blob_v2` ranges).
- Preserves timing for reconstruction (`timestamp`, `minTimestamp`, `maxTimestamp`, inferred duration).
- Includes interaction and error signals per recording (`click_count`, console counts, activity).
- Includes event distribution and plugin presence (`network`, `console`) for model-side routing.
- Redacts any accidental key material (`phc_...`, `phx_...`) from exported event payloads.
