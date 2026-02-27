import {
  fetchRecordingSnapshotSources,
  fetchRecordingBlobData
} from '../../../../../../../../backend/posthog/client.mjs';
import { resolvePosthogRuntime } from '../../../../../../../../backend/posthog/runtime.mjs';

export const runtime = 'nodejs';

export async function GET(request, { params }) {
  try {
    const { projectId, recordingId } = await params;
    const { searchParams } = new URL(request.url);
    const apiHostOverride = searchParams.get('apiHost');
    const { apiHost, personalKey } = await resolvePosthogRuntime(apiHostOverride);

    const snapshotPayload = await fetchRecordingSnapshotSources({
      apiHost,
      personalKey,
      projectId,
      recordingId
    });

    return Response.json({
      ok: true,
      apiHost,
      projectId,
      recordingId,
      sources: snapshotPayload.sources,
      blobSources: snapshotPayload.blobSources,
      blobKeys: snapshotPayload.blobKeys
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve snapshot sources'
      },
      { status: 500 }
    );
  }
}

export async function POST(request, { params }) {
  try {
    const { projectId, recordingId } = await params;
    const { searchParams } = new URL(request.url);
    const apiHostOverride = searchParams.get('apiHost');
    const blobBatchSize = Number.parseInt(searchParams.get('blobBatchSize') ?? '20', 10);
    const body = await request.json().catch(() => ({}));
    const blobKeys = Array.isArray(body?.blobKeys) ? body.blobKeys : [];
    const decompress = body?.decompress !== false;
    const { apiHost, personalKey } = await resolvePosthogRuntime(apiHostOverride);

    const blobPayload = await fetchRecordingBlobData({
      apiHost,
      personalKey,
      projectId,
      recordingId,
      blobKeys,
      blobBatchSize: Number.isNaN(blobBatchSize) ? 20 : blobBatchSize,
      decompress
    });

    return Response.json({
      ok: true,
      apiHost,
      projectId,
      recordingId,
      selectedBlobKeys: blobKeys.map((key) => String(key)),
      decompress: blobPayload.decompress,
      chunks: blobPayload.chunks,
      events: blobPayload.events,
      compressedChunks: blobPayload.compressedChunks
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve selected blob data'
      },
      { status: 500 }
    );
  }
}
