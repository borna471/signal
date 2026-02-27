import { normalizeApiHost, resolvePersonalKey, resolveRuntimeEnv } from './config.mjs';

/**
 * Resolves PostHog auth context used by API routes.
 */
export async function resolvePosthogRuntime(rawApiHost = null) {
  const env = await resolveRuntimeEnv(process.cwd());
  const personalKey = resolvePersonalKey(env);

  if (!personalKey) {
    throw new Error('Missing PostHog personal key. Set POSTHOG_PERSONAL_KEY in env or .env.local.');
  }

  const apiHost = normalizeApiHost(rawApiHost, env.NEXT_PUBLIC_POSTHOG_HOST);
  return { apiHost, personalKey };
}
