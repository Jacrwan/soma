import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { storage } from '../../lib/storage';
import { useSubscription, hasAIAccess } from '../../lib/subscription';
import {
  CREATE_TEMPLATES, CreateTemplate, generateArtifact, GenerateResult,
} from '../../lib/aiArtifacts';
import { readDriveFile, DriveFile } from '../../lib/googleDrive';
import { CanvasAssignment, Subject } from '../../types';
import DriveFilePicker from '../AI/DriveFilePicker';
import styles from './CreateTab.module.css';

type SourceType = 'topic' | 'assignment' | 'subject' | 'file';

interface ResultItem extends GenerateResult { id: string }

const MAX_FILE_CHARS = 12_000;

export default function CreateTab() {
  const navigate = useNavigate();
  const subscription = useSubscription();
  const driveToken = storage.getGoogleDriveToken();

  const assignments = useMemo<CanvasAssignment[]>(() => {
    return [...storage.getCachedAssignments()].sort(
      (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
    );
  }, []);
  const subjects = useMemo<Subject[]>(() => storage.getSubjects().filter(s => !s.archived), []);

  const [template, setTemplate] = useState<CreateTemplate | null>(null);
  const [sourceType, setSourceType] = useState<SourceType>('topic');
  const [topic, setTopic] = useState('');
  const [assignmentId, setAssignmentId] = useState<number | null>(null);
  const [subjectId, setSubjectId] = useState<string>('');
  const [driveFile, setDriveFile] = useState<{ id: string; title: string } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [instructions, setInstructions] = useState('');

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<ResultItem[]>([]);

  function pickTemplate(t: CreateTemplate) {
    setTemplate(t);
    setError('');
  }

  function onPickFile(f: DriveFile) {
    setShowPicker(false);
    setDriveFile({ id: f.id, title: f.name });
  }

  const canGenerate = (() => {
    if (!template || generating || !driveToken) return false;
    if (sourceType === 'topic') return topic.trim().length > 1;
    if (sourceType === 'assignment') return assignmentId != null;
    if (sourceType === 'subject') return !!subjectId;
    if (sourceType === 'file') return !!driveFile;
    return false;
  })();

  async function buildSource(): Promise<{ label: string; context: string }> {
    if (sourceType === 'topic') {
      return { label: topic.trim(), context: '' };
    }
    if (sourceType === 'assignment') {
      const a = assignments.find(x => x.id === assignmentId);
      if (!a) return { label: 'an assignment', context: '' };
      const ctx = [
        `Assignment: ${a.name}`,
        `Course: ${a.courseName}`,
        a.dueAt ? `Due: ${new Date(a.dueAt).toLocaleDateString()}` : '',
        a.description ? `Details: ${a.description}` : '',
      ].filter(Boolean).join('\n');
      return { label: `${a.name} (${a.courseName})`, context: ctx };
    }
    if (sourceType === 'subject') {
      const s = subjects.find(x => x.id === subjectId);
      if (!s) return { label: 'a subject', context: '' };
      const related = assignments.filter(a => a.courseName === s.name).slice(0, 12);
      const ctx = related.length > 0
        ? `Upcoming assignments in ${s.name}:\n${related.map(a => `- ${a.name} (due ${new Date(a.dueAt).toLocaleDateString()})`).join('\n')}`
        : '';
      return { label: s.name, context: ctx };
    }
    // file
    if (!driveFile) return { label: 'a file', context: '' };
    const { title, content } = await readDriveFile(driveToken, driveFile.id);
    const trimmed = content.length > MAX_FILE_CHARS
      ? `${content.slice(0, MAX_FILE_CHARS)}\n\n[Truncated — file is long]`
      : content;
    return { label: title, context: `Contents of "${title}":\n${trimmed}` };
  }

  async function handleGenerate() {
    if (!template || !canGenerate) return;
    setGenerating(true);
    setError('');
    try {
      const { label, context } = await buildSource();
      const result = await generateArtifact({
        template,
        sourceLabel: label,
        sourceContext: context,
        instructions,
        driveToken,
      });
      setResults(prev => [{ ...result, id: crypto.randomUUID() }, ...prev]);
    } catch (err: unknown) {
      const msg = err as Error;
      setError(
        msg.message === 'google_token_expired'
          ? 'Google access expired — reconnect Google Drive in Settings.'
          : msg.message === 'no_access'
          ? "Can't read that file — make sure it's shared with your Google account."
          : msg.message === 'generation_failed'
          ? 'The AI could not produce usable content. Try rephrasing or adding instructions.'
          : msg.message === 'subscription_required'
          ? 'Your subscription has expired. Visit Settings → Subscription.'
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setGenerating(false);
    }
  }

  // ── Gates ──────────────────────────────────────────────────────────────────
  if (subscription.status === 'loading') {
    return <div className={styles.container}><div className={styles.gateCard}>Loading…</div></div>;
  }
  if (!hasAIAccess(subscription.status)) {
    return (
      <div className={styles.container}>
        <div className={styles.gateCard}>
          <h2 className={styles.gateTitle}>Create is part of Soma Premium</h2>
          <p className={styles.gateText}>Generate study notes, slide decks, guides and more with AI.</p>
          <button className={styles.primaryBtn} onClick={() => navigate('/pricing')}>See plans</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Create</h1>
        <p className={styles.subtitle}>Generate study materials and save them straight to Google Drive.</p>
      </header>

      {!driveToken && (
        <div className={styles.banner}>
          <span>Connect Google Drive to create Docs and Slides.</span>
          <button className={styles.bannerBtn} onClick={() => navigate('/settings')}>Connect</button>
        </div>
      )}

      {/* Step 1 — template */}
      <section className={styles.section}>
        <span className={styles.stepLabel}>1 · What do you want to make?</span>
        <div className={styles.templateGrid}>
          {CREATE_TEMPLATES.map(t => (
            <button
              key={t.id}
              className={`${styles.templateCard}${template?.id === t.id ? ` ${styles.templateCardActive}` : ''}`}
              onClick={() => pickTemplate(t)}
            >
              <span className={styles.templateIcon}>{t.icon}</span>
              <span className={styles.templateLabel}>{t.label}</span>
              <span className={styles.templateDesc}>{t.description}</span>
              <span className={styles.templateBadge}>{t.output === 'slides' ? 'Slides' : 'Doc'}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Step 2 — source */}
      {template && (
        <section className={styles.section}>
          <span className={styles.stepLabel}>2 · Based on what?</span>
          <div className={styles.segment}>
            {([
              ['topic', 'Topic'],
              ['assignment', 'Assignment'],
              ['subject', 'Subject'],
              ['file', 'Drive file'],
            ] as [SourceType, string][]).map(([key, label]) => (
              <button
                key={key}
                className={`${styles.segBtn}${sourceType === key ? ` ${styles.segBtnActive}` : ''}`}
                onClick={() => { setSourceType(key); setError(''); }}
              >{label}</button>
            ))}
          </div>

          <div className={styles.sourceInput}>
            {sourceType === 'topic' && (
              <input
                className={styles.input}
                placeholder="e.g. Photosynthesis, the French Revolution, derivatives…"
                value={topic}
                onChange={e => setTopic(e.target.value)}
              />
            )}
            {sourceType === 'assignment' && (
              assignments.length > 0 ? (
                <select
                  className={styles.input}
                  value={assignmentId ?? ''}
                  onChange={e => setAssignmentId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Choose an assignment…</option>
                  {assignments.map(a => (
                    <option key={a.id} value={a.id}>{a.name} — {a.courseName}</option>
                  ))}
                </select>
              ) : (
                <span className={styles.emptyNote}>No Canvas assignments synced. Connect Canvas first.</span>
              )
            )}
            {sourceType === 'subject' && (
              subjects.length > 0 ? (
                <select
                  className={styles.input}
                  value={subjectId}
                  onChange={e => setSubjectId(e.target.value)}
                >
                  <option value="">Choose a subject…</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              ) : (
                <span className={styles.emptyNote}>No subjects yet.</span>
              )
            )}
            {sourceType === 'file' && (
              driveToken ? (
                <div className={styles.fileRow}>
                  <button className={styles.secondaryBtn} onClick={() => setShowPicker(true)}>
                    {driveFile ? 'Change file' : 'Choose from Drive'}
                  </button>
                  {driveFile && <span className={styles.fileChip}>📎 {driveFile.title}</span>}
                </div>
              ) : (
                <span className={styles.emptyNote}>Connect Google Drive to attach a file.</span>
              )
            )}
          </div>

          <textarea
            className={styles.textarea}
            placeholder="Extra instructions (optional) — e.g. focus on chapters 3–4, keep it concise, AP-level…"
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            rows={2}
          />

          <div className={styles.generateRow}>
            <button className={styles.primaryBtn} onClick={handleGenerate} disabled={!canGenerate}>
              {generating ? 'Generating…' : `Create ${template.output === 'slides' ? 'Slides' : 'Doc'}`}
            </button>
            {error && <span className={styles.error}>{error}</span>}
          </div>
        </section>
      )}

      {/* Results */}
      {(generating || results.length > 0) && (
        <section className={styles.section}>
          <span className={styles.stepLabel}>Created</span>
          <div className={styles.resultList}>
            {generating && (
              <div className={styles.resultCard}>
                <span className={styles.resultIcon}>{template?.output === 'slides' ? '📊' : '📄'}</span>
                <div className={styles.resultInfo}>
                  <span className={styles.resultTitle}>Working on it…</span>
                  <span className={styles.resultStatus}>Generating and saving to Google {template?.output === 'slides' ? 'Slides' : 'Docs'}</span>
                </div>
              </div>
            )}
            {results.map(r => (
              <div key={r.id} className={styles.resultCard}>
                <span className={styles.resultIcon}>{r.kind === 'slides' ? '📊' : '📄'}</span>
                <div className={styles.resultInfo}>
                  <span className={styles.resultTitle}>{r.title}</span>
                  <span className={styles.resultStatus}>Created in Google {r.kind === 'slides' ? 'Slides' : 'Docs'}</span>
                </div>
                <a className={styles.openBtn} href={r.url} target="_blank" rel="noopener noreferrer">Open ↗</a>
              </div>
            ))}
          </div>
        </section>
      )}

      {showPicker && driveToken && (
        <DriveFilePicker googleToken={driveToken} onPick={onPickFile} onClose={() => setShowPicker(false)} />
      )}
    </div>
  );
}
