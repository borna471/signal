/**
 * Performs an authenticated request to the PostHog API and returns JSON or raw response.
 */
export async function apiRequest({ apiHost, personalKey, endpoint, expectJson = true }) {
  const requestUrl =
    endpoint.startsWith('http://') || endpoint.startsWith('https://')
      ? endpoint
      : `${apiHost}${endpoint}`;

  const response = await fetch(requestUrl, {
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
  params.set('kind', 'RecordingsQuery');
  params.set('order', 'start_time');
  params.set('filter_test_accounts', 'false');
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
    const params = new URLSearchParams();
    params.set('kind', 'RecordingsQuery');
    params.set('order', 'start_time');
    params.set('session_ids', opts.recordingId);
    params.set('limit', '100');

    const single = await apiRequest({
      apiHost,
      personalKey,
      endpoint: `/api/environments/${projectId}/session_recordings/?${params.toString()}`
    });

    return (single.results ?? []).filter((item) => item.id === opts.recordingId);
  }

  let offset = 0;
  const allById = new Map();

  while (allById.size < opts.limit) {
    const query = buildRecordingsQuery({
      pageSize: Math.min(opts.pageSize, opts.limit - allById.size),
      offset,
      since: opts.since
    });

    const page = await apiRequest({
      apiHost,
      personalKey,
      endpoint: `/api/environments/${projectId}/session_recordings/?${query}`
    });

    const pageResults = (page.results ?? []).filter((recording) =>
      opts.includeOngoing ? true : !recording.ongoing
    );

    for (const recording of pageResults) {
      if (recording?.id && !allById.has(recording.id)) {
        allById.set(recording.id, recording);
      }
    }

    const hasNext = typeof page?.has_next === 'boolean' ? page.has_next : !!page?.next;
    if (!hasNext || !page.results?.length) {
      break;
    }

    offset += page.results.length;
  }

  return [...allById.values()].slice(0, opts.limit);
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
export async function fetchRecordingSnapshotSources({
  apiHost,
  personalKey,
  projectId,
  recordingId
}) {
  const sources = await apiRequest({
    apiHost,
    personalKey,
    endpoint: `/api/environments/${projectId}/session_recordings/${recordingId}/snapshots/`
  });

  const blobSources = (sources.sources ?? []).filter((source) => source.source === 'blob_v2');
  const blobKeys = blobSources.map((source) => String(source.blob_key));

  return {
    sources,
    blobSources,
    blobKeys
  };
}

/**
 * Fetches selected snapshot blob ranges (max 20 keys) and parses replay events.
 */
export async function fetchRecordingBlobData({
  apiHost,
  personalKey,
  projectId,
  recordingId,
  blobKeys,
  blobBatchSize = 20,
  decompress = true
}) {
  const selectedKeys = [...new Set(blobKeys.map((key) => String(key)))];
  if (!selectedKeys.length) {
    throw new Error('No blob keys were selected.');
  }
  if (selectedKeys.length > 20) {
    throw new Error('A maximum of 20 blob keys can be requested at a time.');
  }

  const numericKeys = selectedKeys
    .map(coerceBlobKey)
    .filter((key) => key !== null);

  if (!numericKeys.length) {
    throw new Error('Selected blob keys were invalid.');
  }

  const sources = await apiRequest({
    apiHost,
    personalKey,
    endpoint: `/api/environments/${projectId}/session_recordings/${recordingId}/snapshots/`
  });

  const sourceBlobKeys = (sources.sources ?? [])
    .filter((source) => source.source === 'blob_v2')
    .map((source) => source.blob_key);
  const availableKeys = new Set(sourceBlobKeys.map((key) => String(key)));
  const missingKeys = selectedKeys.filter((key) => !availableKeys.has(key));
  if (missingKeys.length) {
    throw new Error(`Blob keys not found in sources: ${missingKeys.join(', ')}`);
  }

  const ranges = createBlobRanges(numericKeys, blobBatchSize);
  const chunks = [];
  const events = [];
  const compressedChunks = [];

  for (const range of ranges) {
    const endpoint =
      `/api/environments/${projectId}/session_recordings/${recordingId}/snapshots/` +
      `?source=blob_v2&start_blob_key=${range.start}&end_blob_key=${range.end}` +
      `&decompress=${decompress ? 'true' : 'false'}`;

    const response = await apiRequest({
      apiHost,
      personalKey,
      endpoint,
      expectJson: false
    });

    const binary = Buffer.from(await response.arrayBuffer());

    if (decompress) {
      const rangeEvents = parseNdjsonBuffer(binary);
      chunks.push({
        startBlobKey: range.start,
        endBlobKey: range.end,
        eventCount: rangeEvents.length
      });
      events.push(...rangeEvents);
    } else {
      compressedChunks.push({
        startBlobKey: range.start,
        endBlobKey: range.end,
        byteLength: binary.length,
        contentBase64: binary.toString('base64')
      });
    }
  }

  return {
    chunks,
    events,
    compressedChunks,
    decompress
  };
}
