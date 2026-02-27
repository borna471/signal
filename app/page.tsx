'use client';

import { useMemo, useState } from 'react';

type Project = {
  id: number | string;
  name?: string;
};

type Recording = {
  id: string;
  start_time?: string;
  recording_duration?: number;
};

type BlobSource = {
  source?: string;
  start_timestamp?: string;
  end_timestamp?: string;
  blob_key?: string | number;
};

type SnapshotSourcesResponse = {
  ok: boolean;
  apiHost?: string;
  projectId?: string;
  recordingId?: string;
  sources?: { sources?: BlobSource[] };
  blobSources?: BlobSource[];
  blobKeys?: string[];
  error?: string;
};

type BlobDataResponse = {
  ok: boolean;
  apiHost?: string;
  projectId?: string;
  recordingId?: string;
  selectedBlobKeys?: string[];
  decompress?: boolean;
  chunks?: Array<{ startBlobKey: number; endBlobKey: number; eventCount: number }>;
  events?: Array<{ sessionId: string; event: Record<string, unknown> }>;
  compressedChunks?: Array<{
    startBlobKey: number;
    endBlobKey: number;
    byteLength: number;
    contentBase64: string;
  }>;
  error?: string;
};

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default function Page() {
  const [loading, setLoading] = useState<null | 'projects' | 'recordings' | 'sources' | 'blobs'>(null);
  const [error, setError] = useState<string>('');

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsRaw, setProjectsRaw] = useState<unknown>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [recordingsRaw, setRecordingsRaw] = useState<unknown>(null);
  const [selectedRecordingId, setSelectedRecordingId] = useState<string>('');

  const [snapshotSources, setSnapshotSources] = useState<SnapshotSourcesResponse | null>(null);
  const [selectedBlobKeys, setSelectedBlobKeys] = useState<string[]>([]);
  const [blobData, setBlobData] = useState<BlobDataResponse | null>(null);
  const [decompress, setDecompress] = useState<boolean>(true);

  const selectedProject = useMemo(
    () => projects.find((project) => String(project.id) === selectedProjectId),
    [projects, selectedProjectId]
  );

  const selectedRecording = useMemo(
    () => recordings.find((recording) => recording.id === selectedRecordingId),
    [recordings, selectedRecordingId]
  );

  const blobSources = snapshotSources?.blobSources ?? [];

  async function retrieveProjects() {
    setLoading('projects');
    setError('');

    try {
      const response = await fetch('/api/posthog/projects');
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to retrieve projects');
      }

      setProjects(payload.projects ?? []);
      setProjectsRaw(payload);
      setSelectedProjectId('');
      setRecordings([]);
      setRecordingsRaw(null);
      setSelectedRecordingId('');
      setSnapshotSources(null);
      setSelectedBlobKeys([]);
      setBlobData(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve projects');
    } finally {
      setLoading(null);
    }
  }

  async function retrieveRecordings() {
    if (!selectedProjectId) {
      return;
    }

    setLoading('recordings');
    setError('');

    try {
      const response = await fetch(
        `/api/posthog/projects/${encodeURIComponent(selectedProjectId)}/recordings?limit=100&pageSize=50`
      );
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to retrieve recordings');
      }

      setRecordings(payload.recordings ?? []);
      setRecordingsRaw(payload);
      setSelectedRecordingId('');
      setSnapshotSources(null);
      setSelectedBlobKeys([]);
      setBlobData(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve recordings');
    } finally {
      setLoading(null);
    }
  }

  async function retrieveSnapshotSources() {
    if (!selectedProjectId || !selectedRecordingId) {
      return;
    }

    setLoading('sources');
    setError('');

    try {
      const response = await fetch(
        `/api/posthog/projects/${encodeURIComponent(selectedProjectId)}/recordings/${encodeURIComponent(selectedRecordingId)}/snapshots`
      );
      const payload: SnapshotSourcesResponse = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to retrieve snapshot sources');
      }

      setSnapshotSources(payload);
      setSelectedBlobKeys([]);
      setBlobData(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve snapshot sources');
    } finally {
      setLoading(null);
    }
  }

  function toggleBlobKey(blobKey: string) {
    setSelectedBlobKeys((current) => {
      if (current.includes(blobKey)) {
        return current.filter((key) => key !== blobKey);
      }

      if (current.length >= 20) {
        setError('You can select up to 20 blob keys at a time.');
        return current;
      }

      setError('');
      return [...current, blobKey];
    });
  }

  async function retrieveSelectedBlobs() {
    if (!selectedProjectId || !selectedRecordingId || selectedBlobKeys.length === 0) {
      return;
    }

    if (selectedBlobKeys.length > 20) {
      setError('You can request at most 20 blob keys at a time.');
      return;
    }

    setLoading('blobs');
    setError('');

    try {
      const response = await fetch(
        `/api/posthog/projects/${encodeURIComponent(selectedProjectId)}/recordings/${encodeURIComponent(selectedRecordingId)}/snapshots`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blobKeys: selectedBlobKeys, decompress })
        }
      );

      const payload: BlobDataResponse = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to retrieve blob data');
      }

      setBlobData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve blob data');
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="explorer-shell">
      <header className="explorer-header">
        <h1>PostHog Replay Explorer</h1>
        <p>Walk the API chain: projects, recordings, then snapshot blob sources and selected blobs.</p>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="steps-grid">
        <article className="step-panel">
          <div className="step-header">
            <h2>1. Retrieve Projects</h2>
            <button type="button" onClick={retrieveProjects} disabled={loading !== null}>
              {loading === 'projects' ? 'Loading...' : 'Retrieve projects'}
            </button>
          </div>
          <div className="list-scroll">
            {projects.map((project) => (
              <button
                type="button"
                key={String(project.id)}
                className={selectedProjectId === String(project.id) ? 'list-item active' : 'list-item'}
                onClick={() => {
                  setSelectedProjectId(String(project.id));
                  setSelectedRecordingId('');
                  setRecordings([]);
                  setRecordingsRaw(null);
                  setSnapshotSources(null);
                  setSelectedBlobKeys([]);
                  setBlobData(null);
                }}
              >
                <strong>{project.name ?? 'Unnamed project'}</strong>
                <span>ID: {project.id}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="step-panel">
          <div className="step-header">
            <h2>2. Retrieve Session Recordings</h2>
            <button
              type="button"
              onClick={retrieveRecordings}
              disabled={!selectedProjectId || loading !== null}
            >
              {loading === 'recordings' ? 'Loading...' : 'Retrieve session recordings'}
            </button>
          </div>
          <div className="status-line">
            {selectedProject ? `Project: ${selectedProject.name ?? selectedProject.id}` : 'Pick a project first'}
          </div>
          <div className="list-scroll">
            {recordings.map((recording) => (
              <button
                type="button"
                key={recording.id}
                className={selectedRecordingId === recording.id ? 'list-item active' : 'list-item'}
                onClick={() => {
                  setSelectedRecordingId(recording.id);
                  setSnapshotSources(null);
                  setSelectedBlobKeys([]);
                  setBlobData(null);
                }}
              >
                <strong>{recording.id}</strong>
                <span>Duration: {recording.recording_duration ?? 0}s</span>
                <span>Start: {recording.start_time ?? 'n/a'}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="step-panel">
          <div className="step-header">
            <h2>3. Sources + Blob Selection</h2>
            <button
              type="button"
              onClick={retrieveSnapshotSources}
              disabled={!selectedProjectId || !selectedRecordingId || loading !== null}
            >
              {loading === 'sources' ? 'Loading...' : 'Retrieve snapshot sources'}
            </button>
          </div>
          <div className="status-line">
            {selectedRecording ? `Recording: ${selectedRecording.id}` : 'Pick a session recording first'}
          </div>
          <div className="blob-controls">
            <span>Selected blob keys: {selectedBlobKeys.length}/20</span>
            <button
              type="button"
              onClick={retrieveSelectedBlobs}
              disabled={selectedBlobKeys.length === 0 || loading !== null}
            >
              {loading === 'blobs' ? 'Loading...' : 'Retrieve selected blob data'}
            </button>
          </div>
          <label className="toggle-line">
            <input
              type="checkbox"
              checked={decompress}
              onChange={(event) => setDecompress(event.target.checked)}
              disabled={loading !== null}
            />
            <span>
              decompress={decompress ? 'true' : 'false'} ({decompress ? 'JSONL payload' : 'snappy compressed payload'})
            </span>
          </label>
          <div className="list-scroll">
            {blobSources.map((source, idx) => {
              const blobKey = String(source.blob_key ?? idx);
              return (
                <button
                  type="button"
                  key={`${blobKey}-${idx}`}
                  className={selectedBlobKeys.includes(blobKey) ? 'list-item active' : 'list-item'}
                  onClick={() => toggleBlobKey(blobKey)}
                >
                  <strong>blob_key: {blobKey}</strong>
                  <span>Source: {source.source ?? 'blob_v2'}</span>
                  <span>
                    {source.start_timestamp ?? 'n/a'} to {source.end_timestamp ?? 'n/a'}
                  </span>
                </button>
              );
            })}
            {!blobSources.length ? <div className="empty-state">Retrieve snapshot sources to list blob keys.</div> : null}
          </div>
        </article>
      </section>

      <section className="output-grid">
        <article className="output-panel">
          <h3>Projects API output</h3>
          <pre>{projectsRaw ? formatJson(projectsRaw) : 'No projects payload yet.'}</pre>
        </article>

        <article className="output-panel">
          <h3>Session recordings API output</h3>
          <pre>{recordingsRaw ? formatJson(recordingsRaw) : 'No recordings payload yet.'}</pre>
        </article>

        <article className="output-panel output-wide">
          <h3>Snapshot sources API output</h3>
          <pre>{snapshotSources ? formatJson(snapshotSources) : 'No snapshot sources payload yet.'}</pre>
        </article>

        <article className="output-panel output-wide">
          <h3>Selected blob data output</h3>
          <pre>{blobData ? formatJson(blobData) : 'No selected blob data payload yet.'}</pre>
        </article>
      </section>
    </main>
  );
}
