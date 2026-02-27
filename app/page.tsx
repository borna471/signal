'use client';

type Project = {
  id: number | string;
  name?: string;
  created_at?: string;
};

type Recording = {
  id: string;
  start_time?: string;
  end_time?: string;
  recording_duration?: number;
  ongoing?: boolean;
  distinct_id?: string;
  click_count?: number;
  mouse_activity_count?: number;
};

type SnapshotResponse = {
  ok: boolean;
  apiHost?: string;
  projectId?: string;
  recordingId?: string;
  sources?: { sources?: Array<{ source?: string; blob_key?: number }> };
  chunks?: Array<{ startBlobKey: number; endBlobKey: number; eventCount: number }>;
  events?: Array<{ sessionId: string; event: Record<string, unknown> }>;
  error?: string;
};

import { useMemo, useState } from 'react';

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default function Page() {
  const [loading, setLoading] = useState<null | 'projects' | 'recordings' | 'snapshots'>(null);
  const [error, setError] = useState<string>('');

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsRaw, setProjectsRaw] = useState<unknown>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [recordingsRaw, setRecordingsRaw] = useState<unknown>(null);
  const [selectedRecordingId, setSelectedRecordingId] = useState<string>('');

  const [snapshots, setSnapshots] = useState<SnapshotResponse | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => String(project.id) === selectedProjectId),
    [projects, selectedProjectId]
  );

  const selectedRecording = useMemo(
    () => recordings.find((recording) => recording.id === selectedRecordingId),
    [recordings, selectedRecordingId]
  );

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
      setSnapshots(null);
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
      setSnapshots(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve recordings');
    } finally {
      setLoading(null);
    }
  }

  async function retrieveSnapshots() {
    if (!selectedProjectId || !selectedRecordingId) {
      return;
    }

    setLoading('snapshots');
    setError('');

    try {
      const response = await fetch(
        `/api/posthog/projects/${encodeURIComponent(selectedProjectId)}/recordings/${encodeURIComponent(selectedRecordingId)}/snapshots`
      );
      const payload: SnapshotResponse = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to retrieve snapshots');
      }

      setSnapshots(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve snapshots');
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="explorer-shell">
      <header className="explorer-header">
        <h1>PostHog Replay Explorer</h1>
        <p>Walk the API chain to inspect projects, recordings, and replay snapshot events.</p>
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
                  setSnapshots(null);
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
                  setSnapshots(null);
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
            <h2>3. Retrieve Snapshots</h2>
            <button
              type="button"
              onClick={retrieveSnapshots}
              disabled={!selectedProjectId || !selectedRecordingId || loading !== null}
            >
              {loading === 'snapshots' ? 'Loading...' : 'Retrieve snapshots'}
            </button>
          </div>
          <div className="status-line">
            {selectedRecording
              ? `Recording: ${selectedRecording.id}`
              : 'Pick a session recording first'}
          </div>

          {snapshots ? (
            <div className="snapshot-summary">
              <p>Blob ranges: {snapshots.chunks?.length ?? 0}</p>
              <p>Total events: {snapshots.events?.length ?? 0}</p>
              <p>Source entries: {snapshots.sources?.sources?.length ?? 0}</p>
            </div>
          ) : (
            <div className="empty-state">Run snapshot retrieval to inspect replay payloads.</div>
          )}
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
          <h3>Snapshots API output</h3>
          <pre>{snapshots ? formatJson(snapshots) : 'No snapshots payload yet.'}</pre>
        </article>
      </section>
    </main>
  );
}
