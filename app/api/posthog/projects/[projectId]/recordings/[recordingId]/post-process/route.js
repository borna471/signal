import { fetchRecordingBlobData } from '../../../../../../../../backend/posthog/client.mjs';
import { postProcessSnapshotsFromBlobEvents } from '../../../../../../../../backend/posthog/post-processing.mjs';
import { resolvePosthogRuntime } from '../../../../../../../../backend/posthog/runtime.mjs';

export const runtime = 'nodejs';

export async function POST(request, { params }) {
  try {
    const { projectId, recordingId } = await params;
    const { searchParams } = new URL(request.url);
    const apiHostOverride = searchParams.get('apiHost');
    const blobBatchSize = Number.parseInt(searchParams.get('blobBatchSize') ?? '20', 10);
    const body = await request.json().catch(() => ({}));
    const blobKeys = Array.isArray(body?.blobKeys) ? body.blobKeys : [];

    if (!blobKeys.length) {
      return Response.json(
        {
          ok: false,
          error: 'No blob keys selected for post-processing.'
        },
        { status: 400 }
      );
    }

    const { apiHost, personalKey } = await resolvePosthogRuntime(apiHostOverride);

    // We always fetch decompress=true for post-processing so rrweb snapshots are available.
    const blobPayload = await fetchRecordingBlobData({
      apiHost,
      personalKey,
      projectId,
      recordingId,
      blobKeys,
      blobBatchSize: Number.isNaN(blobBatchSize) ? 20 : blobBatchSize,
      decompress: true
    });

    const processed = postProcessSnapshotsFromBlobEvents(blobPayload.events, recordingId);

    return Response.json({
      ok: true,
      apiHost,
      projectId,
      recordingId,
      selectedBlobKeys: blobKeys.map((key) => String(key)),
      fetchedDecompress: true,
      fetchedEvents: blobPayload.events.length,
      postProcessing: processed
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to post-process snapshots'
      },
      { status: 500 }
    );
  }
}
