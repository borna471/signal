import { fetchRecordingSnapshots } from '../../../../../../../../backend/posthog/client.mjs';
import { resolvePosthogRuntime } from '../../../../../../../../backend/posthog/runtime.mjs';

export const runtime = 'nodejs';

export async function GET(request, { params }) {
  try {
    const { projectId, recordingId } = await params;
    const { searchParams } = new URL(request.url);
    const apiHostOverride = searchParams.get('apiHost');
    const blobBatchSize = Number.parseInt(searchParams.get('blobBatchSize') ?? '20', 10);
    const { apiHost, personalKey } = await resolvePosthogRuntime(apiHostOverride);

    const snapshotPayload = await fetchRecordingSnapshots({
      apiHost,
      personalKey,
      projectId,
      recordingId,
      blobBatchSize: Number.isNaN(blobBatchSize) ? 20 : blobBatchSize
    });

    return Response.json({
      ok: true,
      apiHost,
      projectId,
      recordingId,
      sources: snapshotPayload.sources,
      chunks: snapshotPayload.chunks,
      events: snapshotPayload.events
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve snapshots'
      },
      { status: 500 }
    );
  }
}
