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
