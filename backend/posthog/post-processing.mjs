import { gunzipSync } from 'node:zlib';

const EVENT_TYPE = {
  FullSnapshot: 2,
  IncrementalSnapshot: 3,
  Meta: 4,
  Custom: 5
};

const INCREMENTAL_SOURCE = {
  Mutation: 0,
  StyleSheetRule: 8
};

const MUTATION_CHUNK_SIZE = 5000;

const CHROME_EXTENSION_DENY_LIST = {
  'dji-sru': 'snap and read',
  mloajfnmjckfjbeeofcdaecbelnblden: 'snap and read',
  aitopia: 'aitopia',
  becfinhbfclcgokjlobojlnldbfillpf: 'aitopia',
  fnliebffpgomomjeflboommgbdnjadbh: 'sublime pop-up',
  'sublime-root': 'sublime pop-up'
};

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRecordingSnapshot(value) {
  return isObject(value) && 'type' in value && 'timestamp' in value;
}

function unzipJson(base64Value) {
  if (!base64Value || typeof base64Value !== 'string') {
    return undefined;
  }
  const gzipped = Buffer.from(base64Value, 'base64');
  return JSON.parse(gunzipSync(gzipped).toString('utf8'));
}

function decompressEvent(ev) {
  try {
    if (!isObject(ev) || !('cv' in ev)) {
      return ev;
    }

    if (ev.cv !== '2024-10') {
      return ev;
    }

    if (ev.type === EVENT_TYPE.FullSnapshot && typeof ev.data === 'string') {
      return { ...ev, data: unzipJson(ev.data) };
    }

    if (ev.type === EVENT_TYPE.IncrementalSnapshot && isObject(ev.data) && 'source' in ev.data) {
      const source = Number(ev.data.source);

      if (source === INCREMENTAL_SOURCE.StyleSheetRule) {
        return {
          ...ev,
          data: {
            ...ev.data,
            adds: unzipJson(ev.data.adds),
            removes: unzipJson(ev.data.removes)
          }
        };
      }

      if (source === INCREMENTAL_SOURCE.Mutation && 'texts' in ev.data) {
        return {
          ...ev,
          data: {
            ...ev.data,
            adds: unzipJson(ev.data.adds),
            removes: unzipJson(ev.data.removes),
            texts: unzipJson(ev.data.texts),
            attributes: unzipJson(ev.data.attributes)
          }
        };
      }
    }

    return ev;
  } catch {
    return ev;
  }
}

function hasAnyWireframes(snapshotData) {
  return snapshotData.some((d) => isObject(d?.data) && 'wireframes' in d.data);
}

function chunkMutationSnapshot(snapshot) {
  const data = snapshot?.data;
  if (
    snapshot?.type !== EVENT_TYPE.IncrementalSnapshot ||
    !isObject(data) ||
    Number(data.source) !== INCREMENTAL_SOURCE.Mutation ||
    !Array.isArray(data.adds) ||
    data.adds.length <= MUTATION_CHUNK_SIZE
  ) {
    return [snapshot];
  }

  const chunks = [];
  const { adds, removes, texts, attributes } = data;
  const totalAdds = adds.length;
  const chunksCount = Math.ceil(totalAdds / MUTATION_CHUNK_SIZE);

  for (let i = 0; i < chunksCount; i += 1) {
    const startIdx = i * MUTATION_CHUNK_SIZE;
    const endIdx = Math.min((i + 1) * MUTATION_CHUNK_SIZE, totalAdds);
    const isFirstChunk = i === 0;
    const isLastChunk = i === chunksCount - 1;

    const chunkSnapshot = {
      ...snapshot,
      data: {
        ...data,
        adds: adds.slice(startIdx, endIdx),
        removes: isFirstChunk ? removes : [],
        texts: isLastChunk ? texts : [],
        attributes: isLastChunk ? attributes : []
      }
    };

    if ('delay' in snapshot) {
      chunkSnapshot.delay = snapshot.delay || 0;
    }

    chunks.push(chunkSnapshot);
  }

  return chunks;
}

function stripChromeExtensionDataFromNode(node, needles, matchedExtensions) {
  if (!isObject(node)) {
    return false;
  }

  let stripped = false;
  const attributes = isObject(node.attributes) ? node.attributes : {};

  if (typeof node.textContent === 'string' && node.textContent.includes('chrome-extension://')) {
    for (const needle of needles) {
      if (node.textContent.includes(needle)) {
        matchedExtensions.add(CHROME_EXTENSION_DENY_LIST[needle] || needle);
        node.textContent = '';
        stripped = true;
      }
    }
  }

  if (typeof attributes._cssText === 'string' && attributes._cssText.includes('chrome-extension://')) {
    for (const needle of needles) {
      if (attributes._cssText.includes(needle)) {
        matchedExtensions.add(CHROME_EXTENSION_DENY_LIST[needle] || needle);
        attributes._cssText = '';
        stripped = true;
      }
    }
  }

  if (typeof attributes.id === 'string') {
    for (const needle of needles) {
      if (attributes.id.includes(needle)) {
        matchedExtensions.add(CHROME_EXTENSION_DENY_LIST[needle] || needle);
        node.childNodes = [];
        stripped = true;
      }
    }
  }

  if (typeof attributes.class === 'string') {
    for (const needle of needles) {
      if (attributes.class.includes(needle)) {
        matchedExtensions.add(CHROME_EXTENSION_DENY_LIST[needle] || needle);
        attributes.class = attributes.class.replace(needle, '');
        stripped = true;
      }
    }
  }

  if (typeof node.tagName === 'string') {
    if (node.tagName === 'DIV' && typeof attributes.class === 'string') {
      for (const needle of needles) {
        if (attributes.class.includes(needle)) {
          matchedExtensions.add(CHROME_EXTENSION_DENY_LIST[needle] || needle);
          node.childNodes = [];
          stripped = true;
        }
      }
    }

    for (const needle of needles) {
      if (node.tagName.includes(needle)) {
        matchedExtensions.add(CHROME_EXTENSION_DENY_LIST[needle] || needle);
        node.childNodes = [];
        stripped = true;
      }
    }
  }

  if (Array.isArray(node.childNodes)) {
    for (const childNode of node.childNodes) {
      if (stripChromeExtensionDataFromNode(childNode, needles, matchedExtensions)) {
        stripped = true;
      }
    }
  }

  return stripped;
}

function getHrefFromSnapshot(snapshot) {
  const data = snapshot?.data;
  if (!isObject(data)) {
    return undefined;
  }
  return data.href || data?.payload?.href;
}

function buildViewportForTimestamp(snapshots) {
  const metaEvents = snapshots
    .filter(
      (snapshot) =>
        snapshot?.type === EVENT_TYPE.Meta &&
        isObject(snapshot.data) &&
        Number.isFinite(Number(snapshot.data.width)) &&
        Number.isFinite(Number(snapshot.data.height))
    )
    .map((snapshot) => ({
      timestamp: snapshot.timestamp,
      width: String(snapshot.data.width),
      height: String(snapshot.data.height),
      href: snapshot.data.href || 'unknown'
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  return (timestamp) => {
    let candidate = undefined;
    for (const viewport of metaEvents) {
      if (viewport.timestamp <= timestamp) {
        candidate = viewport;
      } else {
        break;
      }
    }
    return candidate;
  };
}

function patchMetaEventIntoWebData(snapshots, sessionRecordingId) {
  const viewportForTimestamp = buildViewportForTimestamp(snapshots);
  const patched = [...snapshots];
  let patchedCount = 0;

  for (let i = patched.length - 1; i >= 0; i -= 1) {
    const snapshot = patched[i];
    if (snapshot.type !== EVENT_TYPE.FullSnapshot) {
      continue;
    }

    const previousEvent = patched[i - 1];
    if (previousEvent?.type === EVENT_TYPE.Meta) {
      continue;
    }

    const viewport = viewportForTimestamp(snapshot.timestamp);
    if (!viewport) {
      continue;
    }

    patched.splice(i, 0, {
      type: EVENT_TYPE.Meta,
      timestamp: snapshot.timestamp,
      windowId: snapshot.windowId || sessionRecordingId,
      data: {
        width: Number.parseInt(viewport.width, 10),
        height: Number.parseInt(viewport.height, 10),
        href: viewport.href || 'unknown'
      }
    });
    patchedCount += 1;
  }

  return { snapshots: patched, patchedCount };
}

function patchMetaEventIntoMobileData(parsedLines, sessionRecordingId) {
  const patched = [...parsedLines];
  let patchedCount = 0;

  try {
    const fullSnapshotIndex = patched.findIndex((line) => line.type === EVENT_TYPE.FullSnapshot);
    const metaIndex = patched.findIndex((line) => line.type === EVENT_TYPE.Meta);

    if (fullSnapshotIndex > -1 && metaIndex === -1) {
      const fullSnapshot = patched[fullSnapshotIndex];
      const targetNode = fullSnapshot?.data?.node?.childNodes?.[1]?.childNodes?.[1]?.childNodes?.[0];
      const width = targetNode?.attributes?.width;
      const height = targetNode?.attributes?.height;

      if (width && height) {
        patched.splice(fullSnapshotIndex, 0, {
          windowId: fullSnapshot.windowId || sessionRecordingId,
          type: EVENT_TYPE.Meta,
          timestamp: fullSnapshot.timestamp,
          data: {
            href: getHrefFromSnapshot(fullSnapshot) || '',
            width,
            height
          }
        });
        patchedCount += 1;
      }
    }
  } catch {
    // Ignore mobile patch failures and keep data as-is.
  }

  return { snapshots: patched, patchedCount };
}

function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i += 1) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function normalizeInputRow(raw, sessionIdFallback) {
  if (!raw) {
    return [];
  }

  if (typeof raw === 'string') {
    try {
      return normalizeInputRow(JSON.parse(raw), sessionIdFallback);
    } catch {
      return [];
    }
  }

  if (Array.isArray(raw) && raw.length >= 2) {
    const [windowId, data] = raw;
    return [{ windowId, data: [data] }];
  }

  if (isRecordingSnapshot(raw)) {
    return [{ windowId: raw.windowId || sessionIdFallback, data: [raw] }];
  }

  if (isObject(raw) && Array.isArray(raw.data)) {
    return [{ windowId: raw.window_id || raw.windowId || sessionIdFallback, data: raw.data }];
  }

  return [];
}

export function postProcessSnapshotsFromBlobEvents(blobEvents, sessionRecordingId) {
  const normalizedRows = [];

  for (const row of blobEvents ?? []) {
    const sessionId = row?.sessionId || sessionRecordingId;
    const rows = normalizeInputRow(row?.event, sessionId);
    normalizedRows.push(...rows);
  }

  let isMobileSnapshots = false;
  const parsedLines = [];

  for (const row of normalizedRows) {
    const snapshotData = row.data;
    if (!isMobileSnapshots && Array.isArray(snapshotData)) {
      isMobileSnapshots = hasAnyWireframes(snapshotData);
    }

    for (const item of snapshotData) {
      const currentEvent = decompressEvent(item);
      if (!isObject(currentEvent) || !('timestamp' in currentEvent) || !('type' in currentEvent)) {
        continue;
      }

      const baseSnapshot = {
        windowId: row.windowId || currentEvent.windowId || sessionRecordingId,
        ...currentEvent
      };

      parsedLines.push(...chunkMutationSnapshot(baseSnapshot));
    }
  }

  const mobilePatch = isMobileSnapshots
    ? patchMetaEventIntoMobileData(parsedLines, sessionRecordingId)
    : { snapshots: parsedLines, patchedCount: 0 };
  const parsedWithMobilePatch = mobilePatch.snapshots;

  const seenHashes = new Set();
  const matchedExtensions = new Set();
  const dedupedAndStripped = [];
  let duplicatesDropped = 0;
  let needToPatchMeta = false;
  let sawMeta = false;
  let chromeStripCount = 0;

  for (const snapshot of parsedWithMobilePatch) {
    const { delay: _delay, ...delayFreeSnapshot } = snapshot;
    const seenKey = snapshot.seen || cyrb53(JSON.stringify(delayFreeSnapshot));
    snapshot.seen = seenKey;

    if (seenHashes.has(seenKey)) {
      duplicatesDropped += 1;
      continue;
    }
    seenHashes.add(seenKey);

    if (sawMeta) {
      if (snapshot.type === EVENT_TYPE.FullSnapshot) {
        sawMeta = false;
      } else {
        needToPatchMeta = true;
      }
    } else if (snapshot.type === EVENT_TYPE.Meta) {
      sawMeta = true;
    }

    if (snapshot.type === EVENT_TYPE.FullSnapshot && isObject(snapshot?.data?.node)) {
      if (
        stripChromeExtensionDataFromNode(
          snapshot.data.node,
          Object.keys(CHROME_EXTENSION_DENY_LIST),
          matchedExtensions
        )
      ) {
        chromeStripCount += 1;
        dedupedAndStripped.unshift({
          type: EVENT_TYPE.Custom,
          data: {
            tag: 'chrome-extension-stripped',
            payload: {
              extensions: Array.from(matchedExtensions)
            }
          },
          timestamp: snapshot.timestamp,
          windowId: snapshot.windowId
        });
      }
    }

    dedupedAndStripped.push(snapshot);
  }

  dedupedAndStripped.sort((a, b) => a.timestamp - b.timestamp);

  const webPatch = needToPatchMeta
    ? patchMetaEventIntoWebData(dedupedAndStripped, sessionRecordingId)
    : { snapshots: dedupedAndStripped, patchedCount: 0 };

  return {
    processedSnapshots: webPatch.snapshots,
    summary: {
      inputBlobEvents: Array.isArray(blobEvents) ? blobEvents.length : 0,
      normalizedRows: normalizedRows.length,
      parsedSnapshots: parsedLines.length,
      mobileWireframesDetected: isMobileSnapshots,
      mobileMetaPatched: mobilePatch.patchedCount,
      duplicatesDropped,
      chromeExtensionStrips: chromeStripCount,
      matchedChromeExtensions: Array.from(matchedExtensions),
      sortedSnapshots: dedupedAndStripped.length,
      webMetaPatched: webPatch.patchedCount,
      finalSnapshots: webPatch.snapshots.length
    },
    notes: {
      mobileTransform: 'not-open-source-in-posthog-ee; kept as identity transform'
    }
  };
}
