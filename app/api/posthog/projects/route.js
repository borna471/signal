import { fetchProjects } from '../../../../backend/posthog/client.mjs';
import { resolvePosthogRuntime } from '../../../../backend/posthog/runtime.mjs';

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number.parseInt(searchParams.get('limit') ?? '100', 10);
    const apiHostOverride = searchParams.get('apiHost');
    const { apiHost, personalKey } = await resolvePosthogRuntime(apiHostOverride);

    const projects = await fetchProjects({
      apiHost,
      personalKey,
      limit: Number.isNaN(limit) ? 100 : limit
    });

    return Response.json({
      ok: true,
      apiHost,
      projects
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve projects'
      },
      { status: 500 }
    );
  }
}
