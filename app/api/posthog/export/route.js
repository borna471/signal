import { exportPosthogRecordings } from '../../../../backend/posthog/exporter.mjs';

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await exportPosthogRecordings(body ?? {});

    return Response.json(
      {
        ok: true,
        manifestPath: result.manifestPath,
        recordingsExported: result.recordingsExported,
        manifest: result.manifest
      },
      { status: 200 }
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Export failed'
      },
      { status: 500 }
    );
  }
}
