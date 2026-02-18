import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Loads key/value pairs from .env.local in the given working directory.
 */
export async function loadDotEnvLocal(cwd = process.cwd()) {
  const envPath = path.join(cwd, '.env.local');

  try {
    const raw = await fs.readFile(envPath, 'utf8');
    const parsed = {};

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const idx = trimmed.indexOf('=');
      if (idx === -1) {
        continue;
      }

      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }

      parsed[key] = value;
    }

    return parsed;
  } catch {
    return {};
  }
}

/**
 * Converts ingest/SDK hosts into the matching PostHog API base URL.
 */
export function normalizeApiHost(rawApiHost, ingestHost) {
  if (rawApiHost) {
    return rawApiHost.replace(/\/$/, '');
  }

  if (!ingestHost) {
    return 'https://us.posthog.com';
  }

  const normalized = ingestHost.replace(/\/$/, '');

  if (normalized.includes('eu.i.posthog.com')) {
    return 'https://eu.posthog.com';
  }

  if (normalized.includes('us.i.posthog.com')) {
    return 'https://us.posthog.com';
  }

  if (normalized.includes('i.posthog.com')) {
    return normalized.replace('i.posthog.com', 'posthog.com');
  }

  return normalized;
}

/**
 * Returns the PostHog personal API key from a provided environment object.
 */
export function resolvePersonalKey(env) {
  return env.POSTHOG_PERSONAL_KEY ?? env.POSTHOG_PERSONAL_API_KEY ?? null;
}

/**
 * Merges .env.local values with process.env (process.env takes precedence).
 */
export async function resolveRuntimeEnv(cwd = process.cwd()) {
  const envLocal = await loadDotEnvLocal(cwd);
  return {
    ...envLocal,
    ...process.env
  };
}
