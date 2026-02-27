import { fetchRecordings } from '../../../../../../backend/posthog/client.mjs';
import { resolvePosthogRuntime } from '../../../../../../backend/posthog/runtime.mjs';

export const runtime = 'nodejs';

function asInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export async function GET(request, { params }) {
  try {
    const { projectId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = asInt(searchParams.get('limit'), 200);
    const pageSize = asInt(searchParams.get('pageSize'), Math.min(limit, 100));
    const since = searchParams.get('since');
    const includeOngoing = searchParams.get('includeOngoing') !== 'false';
    const recordingId = searchParams.get('recordingId');
    const apiHostOverride = searchParams.get('apiHost');
    const { apiHost, personalKey } = await resolvePosthogRuntime(apiHostOverride);

    const recordings = await fetchRecordings({
      apiHost,
      personalKey,
      projectId,
      opts: {
        limit,
        pageSize,
        since,
        includeOngoing,
        recordingId
      }
    });

    return Response.json({
      ok: true,
      apiHost,
      projectId,
      recordings
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve session recordings'
      },
      { status: 500 }
    );
  }
}
