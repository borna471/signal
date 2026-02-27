/**
 * Performs an authenticated request to the PostHog API and returns JSON or raw response.
 */
export async function apiRequest({ apiHost, personalKey, endpoint, expectJson = true }) {
  const response = await fetch(`${apiHost}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${personalKey}`,
      Accept: '*/*'
    }
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`PostHog API ${response.status} ${response.statusText}: ${errText}`);
  }

  return expectJson ? response.json() : response;
}

/**
 * Fetches projects available to the authenticated key.
 */
export async function fetchProjects({ apiHost, personalKey, limit = 100 }) {
  const payload = await apiRequest({
    apiHost,
    personalKey,
    endpoint: `/api/projects/?limit=${Math.max(1, Number.parseInt(String(limit), 10) || 100)}`
  });

  return payload?.results ?? [];
}

/**
 * Resolves the target project ID, either from explicit input or first available project.
 */
export async function resolveProjectId({ apiHost, personalKey, explicitProjectId }) {
  if (explicitProjectId) {
    return String(explicitProjectId);
  }

  const projects = await apiRequest({
    apiHost,
    personalKey,
    endpoint: '/api/projects/?limit=100'
  });

  if (!projects?.results?.length) {
    throw new Error('No PostHog projects were found for this personal key.');
  }

  return String(projects.results[0].id);
}

/**
 * Builds query parameters for paginated session recording list requests.
 */
function buildRecordingsQuery({ pageSize, offset, since }) {
  const params = new URLSearchParams();
  params.set('limit', String(pageSize));
  params.set('offset', String(offset));
  if (since) {
    params.set('date_from', since);
  }
  return params.toString();
}

/**
 * Fetches recordings with optional recording-id targeting, pagination, and ongoing filtering.
 */
export async function fetchRecordings({ apiHost, personalKey, projectId, opts }) {
  if (opts.recordingId) {
    const single = await apiRequest({
      apiHost,
      personalKey,
      endpoint: `/api/projects/${projectId}/session_recordings/?session_ids=${encodeURIComponent(opts.recordingId)}`
    });

    return (single.results ?? []).filter((item) => item.id === opts.recordingId);
  }

  let offset = 0;
  const all = [];

  while (all.length < opts.limit) {
    const query = buildRecordingsQuery({
      pageSize: Math.min(opts.pageSize, opts.limit - all.length),
      offset,
      since: opts.since
    });

    const page = await apiRequest({
      apiHost,
      personalKey,
      endpoint: `/api/projects/${projectId}/session_recordings/?${query}`
    });

    const pageResults = (page.results ?? []).filter((recording) =>
      opts.includeOngoing ? true : !recording.ongoing
    );

    all.push(...pageResults);

    if (!page.has_next || !page.results?.length) {
      break;
    }

    offset += page.results.length;
  }

  return all.slice(0, opts.limit);
}

function coerceBlobKey(blobKey) {
  const asNumber = Number.parseInt(String(blobKey), 10);
  return Number.isNaN(asNumber) ? null : asNumber;
}

function createBlobRanges(keys, batchSize) {
  const safeBatchSize = Math.max(1, Number.parseInt(String(batchSize), 10) || 20);
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
      const end = Math.min(cursor + safeBatchSize - 1, range.end);
      batched.push({ start: cursor, end });
      cursor = end + 1;
    }
  }

  return batched;
}

function parseNdjsonBuffer(buffer) {
  const lines = buffer.toString('utf8').split(/\r?\n/).filter((line) => line.trim().length > 0);
  const parsed = [];

  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (Array.isArray(row) && row.length >= 2) {
        parsed.push({
          sessionId: row[0],
          event: row[1]
        });
      }
    } catch {
      // Ignore malformed NDJSON rows.
    }
  }

  return parsed;
}

/**
 * Fetches and parses snapshot blobs for a recording into replay events.
 */
export async function fetchRecordingSnapshots({
  apiHost,
  personalKey,
  projectId,
  recordingId,
  blobBatchSize = 20
}) {
  const sources = await apiRequest({
    apiHost,
    personalKey,
    endpoint: `/api/projects/${projectId}/session_recordings/${recordingId}/snapshots/`
  });

  const blobKeys = (sources.sources ?? [])
    .filter((source) => source.source === 'blob_v2')
    .map((source) => source.blob_key);
  const ranges = createBlobRanges(blobKeys, blobBatchSize);
  const chunks = [];
  const events = [];

  for (const range of ranges) {
    const endpoint =
      `/api/projects/${projectId}/session_recordings/${recordingId}/snapshots/` +
      `?source=blob_v2&start_blob_key=${range.start}&end_blob_key=${range.end}`;

    const response = await apiRequest({
      apiHost,
      personalKey,
      endpoint,
      expectJson: false
    });

    const rangeEvents = parseNdjsonBuffer(Buffer.from(await response.arrayBuffer()));
    chunks.push({
      startBlobKey: range.start,
      endBlobKey: range.end,
      eventCount: rangeEvents.length
    });
    events.push(...rangeEvents);
  }

  return {
    sources,
    chunks,
    events
  };
}
