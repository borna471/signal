import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchRecordings, apiRequest, resolveProjectId } from './client.mjs';
import { normalizeApiHost, resolvePersonalKey, resolveRuntimeEnv } from './config.mjs';

const DEFAULT_OPTIONS = {
  limit: 25,
  outDir: 'data/posthog-export',
  recordingId: null,
  projectId: null,
  apiHost: null,
  since: null,
  pageSize: 25,
  blobBatchSize: 20,
  includeOngoing: false
};

/**
 * Parses CLI arguments into normalized exporter options.
 */
export function parseCliArgs(argv) {
  const out = { ...DEFAULT_OPTIONS };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--limit' && next) {
      out.limit = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--out-dir' && next) {
      out.outDir = next;
      i += 1;
    } else if (arg === '--recording-id' && next) {
      out.recordingId = next;
      i += 1;
    } else if (arg === '--project-id' && next) {
      out.projectId = next;
      i += 1;
    } else if (arg === '--api-host' && next) {
      out.apiHost = next;
      i += 1;
    } else if (arg === '--since' && next) {
      out.since = next;
      i += 1;
    } else if (arg === '--page-size' && next) {
      out.pageSize = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--blob-batch-size' && next) {
      out.blobBatchSize = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--include-ongoing') {
      out.includeOngoing = true;
    }
  }

  return out;
}

/**
 * Redacts PostHog token-like substrings recursively from strings/objects/arrays in place.
 */
function sanitizeSecretsInPlace(value) {
  if (!value) {
    return;
  }

  if (typeof value === 'string') {
    return value
      .replace(/phc_[A-Za-z0-9]{20,}/g, '[REDACTED_POSTHOG_PROJECT_KEY]')
      .replace(/phx_[A-Za-z0-9]{20,}/g, '[REDACTED_POSTHOG_PERSONAL_KEY]');
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const next = sanitizeSecretsInPlace(value[i]);
      if (typeof next === 'string') {
        value[i] = next;
      }
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      const next = sanitizeSecretsInPlace(nested);
      if (typeof next === 'string') {
        value[key] = next;
      }
    }
  }
}

/**
 * Applies event-level redaction rules before events are persisted.
 */
function redactSensitiveEvent(event) {
  sanitizeSecretsInPlace(event);

  if (event?.type === 5 && event?.data?.tag === '$posthog_config') {
    const cfg = event.data?.payload?.config;
    if (cfg && typeof cfg === 'object' && typeof cfg.token === 'string') {
      cfg.token = '[REDACTED]';
    }
  }

  return event;
}

/**
 * Coerces a blob key into an integer or returns null for invalid keys.
 */
function coerceBlobKey(blobKey) {
  const asNumber = Number.parseInt(String(blobKey), 10);
  return Number.isNaN(asNumber) ? null : asNumber;
}

/**
 * Compresses blob keys into contiguous ranges and then batches each range.
 */
function createBlobRanges(keys, batchSize) {
  const sorted = [...new Set(keys)]
    .map(coerceBlobKey)
    .filter((k) => k !== null)
    .sort((a, b) => a - b);

  if (!sorted.length) {
    return [];
  }

  const contiguous = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    if (next === prev + 1) {
      prev = next;
      continue;
    }

    contiguous.push({ start, end: prev });
    start = next;
    prev = next;
  }

  contiguous.push({ start, end: prev });

  const batched = [];
  for (const range of contiguous) {
    let cursor = range.start;
    while (cursor <= range.end) {
      const end = Math.min(cursor + batchSize - 1, range.end);
      batched.push({ start: cursor, end });
      cursor = end + 1;
    }
  }

  return batched;
}

/**
 * Parses NDJSON replay payloads into [sessionId, event] tuples with redaction.
 */
function parseNdjsonBuffer(buffer) {
  const lines = buffer.toString('utf8').split(/\r?\n/).filter((line) => line.trim().length > 0);
  const parsed = [];

  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (Array.isArray(row) && row.length >= 2) {
        parsed.push({
          sessionId: row[0],
          event: redactSensitiveEvent(row[1])
        });
      }
    } catch {
      // Ignore malformed rows and continue.
    }
  }

  return parsed;
}

/**
 * Computes aggregate replay metrics from parsed event rows.
 */
function summarizeParsedEvents(parsedEvents) {
  const eventTypeCounts = {};
  let minTimestamp = Number.POSITIVE_INFINITY;
  let maxTimestamp = 0;
  let clickEvents = 0;
  let mutationEvents = 0;
  let fullSnapshotEvents = 0;
  let hasConsolePluginEvents = false;
  let hasNetworkPluginEvents = false;

  for (const { event } of parsedEvents) {
    const typeKey = String(event?.type ?? 'unknown');
    eventTypeCounts[typeKey] = (eventTypeCounts[typeKey] ?? 0) + 1;

    const ts = Number(event?.timestamp);
    if (Number.isFinite(ts)) {
      minTimestamp = Math.min(minTimestamp, ts);
      maxTimestamp = Math.max(maxTimestamp, ts);
    }

    if (event?.type === 3) {
      if (event?.data?.source === 2 && event?.data?.type === 2) {
        clickEvents += 1;
      }
      if (event?.data?.source === 0) {
        mutationEvents += 1;
      }
    }

    if (event?.type === 2) {
      fullSnapshotEvents += 1;
    }

    if (event?.data?.plugin === 'rrweb/console@1') {
      hasConsolePluginEvents = true;
    }

    if (event?.data?.plugin === 'rrweb/network@1') {
      hasNetworkPluginEvents = true;
    }
  }

  return {
    totalEvents: parsedEvents.length,
    eventTypeCounts,
    minTimestamp: Number.isFinite(minTimestamp) ? minTimestamp : null,
    maxTimestamp,
    inferredDurationMs:
      Number.isFinite(minTimestamp) && maxTimestamp > 0 ? maxTimestamp - minTimestamp : null,
    clickEvents,
    mutationEvents,
    fullSnapshotEvents,
    hasConsolePluginEvents,
    hasNetworkPluginEvents
  };
}

/**
 * Builds normalized manifest hints used for replay reconstruction and model analysis.
 */
function buildAnalysisHints(recording, snapshotExport) {
  return {
    recordingId: recording.id,
    distinctId: recording.distinct_id,
    timeline: {
      startTime: recording.start_time,
      endTime: recording.end_time,
      recordingDurationSec: recording.recording_duration,
      activeSeconds: recording.active_seconds,
      inactiveSeconds: recording.inactive_seconds
    },
    interactionSignals: {
      clickCount: recording.click_count,
      keypressCount: recording.keypress_count,
      mouseActivityCount: recording.mouse_activity_count
    },
    errorSignals: {
      consoleLogCount: recording.console_log_count,
      consoleWarnCount: recording.console_warn_count,
      consoleErrorCount: recording.console_error_count
    },
    reconstructionInputs: {
      sourcesFile: path.join(snapshotExport.recordingDir, 'sources.json'),
      ndjsonChunks: snapshotExport.files.map((f) => f.file),
      minTimestampMs: snapshotExport.summary.minTimestamp,
      maxTimestampMs: snapshotExport.summary.maxTimestamp,
      inferredDurationMs: snapshotExport.summary.inferredDurationMs
    },
    visionModelHints: {
      baseUrl: recording.start_url,
      hasNetworkTimeline: snapshotExport.summary.hasNetworkPluginEvents,
      hasConsoleTimeline: snapshotExport.summary.hasConsolePluginEvents,
      fullSnapshotEvents: snapshotExport.summary.fullSnapshotEvents,
      eventTypeCounts: snapshotExport.summary.eventTypeCounts
    }
  };
}

/**
 * Downloads one recording's snapshot sources and blob event chunks, then writes export files.
 */
async function exportRecordingSnapshots({ apiHost, personalKey, projectId, recording, outDir, blobBatchSize }) {
  const recordingDir = path.join(outDir, recording.id);
  await fs.mkdir(recordingDir, { recursive: true });

  const sources = await apiRequest({
    apiHost,
    personalKey,
    endpoint: `/api/projects/${projectId}/session_recordings/${recording.id}/snapshots/`
  });

  await fs.writeFile(path.join(recordingDir, 'sources.json'), `${JSON.stringify(sources, null, 2)}\n`, 'utf8');

  const blobKeys = (sources.sources ?? [])
    .filter((source) => source.source === 'blob_v2')
    .map((source) => source.blob_key);

  const ranges = createBlobRanges(blobKeys, blobBatchSize);
  const files = [];
  let parsedEvents = [];

  for (const range of ranges) {
    const endpoint =
      `/api/projects/${projectId}/session_recordings/${recording.id}/snapshots/` +
      `?source=blob_v2&start_blob_key=${range.start}&end_blob_key=${range.end}`;

    const response = await apiRequest({
      apiHost,
      personalKey,
      endpoint,
      expectJson: false
    });

    const parsedRangeEvents = parseNdjsonBuffer(Buffer.from(await response.arrayBuffer()));
    const output = parsedRangeEvents.map((entry) => JSON.stringify([entry.sessionId, entry.event])).join('\n');
    const file = path.join(recordingDir, `events-${range.start}-${range.end}.ndjson`);

    await fs.writeFile(file, `${output}\n`, 'utf8');

    parsedEvents = parsedEvents.concat(parsedRangeEvents);
    files.push({
      startBlobKey: range.start,
      endBlobKey: range.end,
      file,
      eventsInChunk: parsedRangeEvents.length
    });
  }

  const summary = summarizeParsedEvents(parsedEvents);
  await fs.writeFile(path.join(recordingDir, 'event-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  return {
    recordingId: recording.id,
    recordingDir,
    sourceCount: (sources.sources ?? []).length,
    blobRangesDownloaded: files.length,
    eventsExtracted: summary.totalEvents,
    files,
    summary
  };
}

/**
 * Main backend export workflow: resolves config, fetches recordings, exports snapshots, and writes manifest.
 */
export async function exportPosthogRecordings(rawOptions = {}) {
  const env = await resolveRuntimeEnv(process.cwd());
  const options = { ...DEFAULT_OPTIONS, ...rawOptions };

  const personalKey = resolvePersonalKey(env);
  if (!personalKey) {
    throw new Error('Missing PostHog personal key. Set POSTHOG_PERSONAL_KEY in env or .env.local.');
  }

  const apiHost = normalizeApiHost(options.apiHost, env.NEXT_PUBLIC_POSTHOG_HOST);
  await fs.mkdir(options.outDir, { recursive: true });

  const projectId = await resolveProjectId({
    apiHost,
    personalKey,
    explicitProjectId: options.projectId
  });

  const recordings = await fetchRecordings({
    apiHost,
    personalKey,
    projectId,
    opts: options
  });

  if (!recordings.length) {
    throw new Error('No recordings matched the query.');
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    apiHost,
    projectId,
    requested: {
      limit: options.limit,
      recordingId: options.recordingId,
      since: options.since,
      includeOngoing: options.includeOngoing,
      pageSize: options.pageSize,
      blobBatchSize: options.blobBatchSize
    },
    recordings: []
  };

  for (const recording of recordings) {
    const snapshotExport = await exportRecordingSnapshots({
      apiHost,
      personalKey,
      projectId,
      recording,
      outDir: options.outDir,
      blobBatchSize: options.blobBatchSize
    });

    manifest.recordings.push({
      ...buildAnalysisHints(recording, snapshotExport),
      files: snapshotExport.files
    });
  }

  const manifestPath = path.join(options.outDir, 'manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    manifest,
    manifestPath,
    recordingsExported: manifest.recordings.length
  };
}
