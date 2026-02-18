#!/usr/bin/env node
import { exportPosthogRecordings, parseCliArgs } from '../backend/posthog/exporter.mjs';

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await exportPosthogRecordings(options);

  for (const recording of result.manifest.recordings) {
    console.log(`Exported ${recording.recordingId}: ${recording.files.length} file range(s)`);
  }

  console.log(`Manifest written to ${result.manifestPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
