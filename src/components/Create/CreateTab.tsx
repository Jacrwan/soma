import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { storage } from '../../lib/storage';
import { useSubscription, hasAIAccess } from '../../lib/subscription';
import {
  CREATE_TEMPLATES, CreateTemplate, PreviewResult,
  generatePreview, savePreviewToDrive, GenerateResult,
} from '../../lib/aiArtifacts';
import { readDriveFile } from '../../lib/googleDrive';
import { useGooglePicker, PickedFile } from '../../lib/useGooglePicker';
import { CanvasAssignment, Subject } from '../../types';
import styles from './CreateTab.module.css';

type SourceType = 'topic' | 'assignment' | 'subject' | 'file';

interface SavedCreation {
  id: string;
  kind: 'doc' | 'slides';
  title: string;
  url: string;
  templateLabel: string;
  sourceLabel: string;
  createdAt: string;
}

const HISTORY_KEY = 'soma_create_history';
const MAX_HISTORY = 30;
const MAX_FILE_CHARS = 12_000;

function loadHistory(): SavedCreation[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { return []; }
}

function saveHistory(items: SavedCreation[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
}

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
  const [instructions, setInstructions] = useState('');

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [history, setHistory] = useState<SavedCreation[]>(loadHistory);

  const previewRef = useRef<HTMLDivElement>(null);
  const topicRef = useRef<HTMLInputElement>(null);

  function pickTemplate(t: CreateTemplate) {
    setTemplate(t);
    setError('');
    setPreview(null);
  }

  function onPickFile(f: PickedFile) {
    setDriveFile({ id: f.id, title: f.name });
  }

  const { openPicker } = useGooglePicker(driveToken, onPickFile);

  const canGenerate = (() => {
    if (!template || generating || saving) return false;
    if (sourceType === 'topic') return topic.trim().length > 1;
    if (sourceType === 'assignment') return assignmentId != null;
    if (sourceType === 'subject') return !!subjectId;
    if (sourceType === 'file') return !!driveFile;
    return false;
  })();

  const buildSource = useCallback(async (): Promise<{ label: string; context: string }> => {
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
    if (!driveFile) return { label: 'a file', context: '' };
    const { title, content } = await readDriveFile(driveToken, driveFile.id);
    const trimmed = content.length > MAX_FILE_CHARS
      ? `${content.slice(0, MAX_FILE_CHARS)}\n\n[Truncated — file is long]`
      : content;
    return { label: title, context: `Contents of "${title}":\n${trimmed}` };
  }, [sourceType, topic, assignments, assignmentId, subjects, subjectId, driveFile, driveToken]);

  async function handleGenerate() {
    if (!template || !canGenerate) return;
    setGenerating(true);
    setError('');
    setPreview(null);
    try {
      const { label, context } = await buildSource();
      const result = await generatePreview({
        template,
        sourceLabel: label,
        sourceContext: context,
        instructions,
      });
      setPreview(result);
      setTimeout(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
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

  async function handleSaveToDrive() {
    if (!preview || !driveToken) return;
    setSaving(true);
    setError('');
    try {
      const result = await savePreviewToDrive(preview, driveToken);
      const creation: SavedCreation = {
        id: crypto.randomUUID(),
        kind: result.kind,
        title: result.title,
        url: result.url,
        templateLabel: template?.label || '',
        sourceLabel: sourceType === 'topic' ? topic.trim() : '',
        createdAt: new Date().toISOString(),
      };
      const updated = [creation, ...history];
      setHistory(updated);
      saveHistory(updated);
      setPreview(null);
    } catch (err: unknown) {
      const msg = err as Error;
      setError(
        msg.message === 'google_token_expired'
          ? 'Google access expired — reconnect Google Drive in Settings.'
          : msg.message === 'subscription_required'
          ? 'Your subscription has expired.'
          : 'Failed to save to Drive. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && canGenerate && !preview) {
      e.preventDefault();
      handleGenerate();
    }
  }

  function clearHistory() {
    setHistory([]);
    localStorage.removeItem(HISTORY_KEY);
  }

  useEffect(() => {
    if (template && sourceType === 'topic') topicRef.current?.focus();
  }, [template, sourceType]);

  function renderPreviewContent() {
    if (!preview) return null;
    if (preview.kind === 'slides' && preview.slidesSpec) {
      return (
        <div className={styles.previewSlides}>
          {preview.slidesSpec.slides.map((slide, i) => (
            <div key={i} className={styles.slideCard}>
              <span className={styles.slideNumber}>{i + 1}</span>
              <div className={styles.slideContent}>
                <h4 className={styles.slideTitle}>{slide.title}</h4>
                <ul className={styles.slideBullets}>
                  {slide.bullets.map((b, j) => <li key={j}>{b}</li>)}
                </ul>
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (preview.docSpec) {
      return (
        <div className={styles.previewDoc}>
          {preview.docSpec.content.split('\n').map((line, i) => {
            if (!line.trim()) return <br key={i} />;
            const isBold = line.startsWith('**') && line.endsWith('**');
            const isHeading = /^[A-Z][^a-z]*$/.test(line.trim()) || isBold;
            const isBullet = line.trimStart().startsWith('- ') || line.trimStart().startsWith('• ');
            if (isHeading) return <h4 key={i} className={styles.previewHeading}>{line.replace(/\*\*/g, '')}</h4>;
            if (isBullet) return <p key={i} className={styles.previewBullet}>{line.replace(/^[\s]*[-•]\s*/, '')}</p>;
            return <p key={i} className={styles.previewPara}>{line}</p>;
          })}
        </div>
      );
    }
    return null;
  }

  function formatTimeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }

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
              <span className={`${styles.templateBadge} ${t.output === 'slides' ? styles.templateBadgeSlides : ''}`}>
                {t.output === 'slides' ? 'Slides' : 'Doc'}
              </span>
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
                onClick={() => { setSourceType(key); setError(''); setPreview(null); }}
              >{label}</button>
            ))}
          </div>

          <div className={styles.sourceInput}>
            {sourceType === 'topic' && (
              <input
                ref={topicRef}
                className={styles.input}
                placeholder="e.g. Photosynthesis, the French Revolution, derivatives…"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                onKeyDown={handleKeyDown}
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
                  <button className={styles.secondaryBtn} onClick={() => openPicker()}>
                    {driveFile ? 'Change file' : 'Choose from Drive'}
                  </button>
                  {driveFile && <span className={styles.fileChip}>{driveFile.title}</span>}
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
              {generating ? 'Generating…' : preview ? 'Regenerate' : `Generate ${template.output === 'slides' ? 'Slides' : 'Doc'}`}
            </button>
            {error && <span className={styles.error}>{error}</span>}
          </div>
        </section>
      )}

      {/* Generating skeleton */}
      {generating && (
        <section className={styles.section}>
          <span className={styles.stepLabel}>Generating…</span>
          <div className={styles.skeleton}>
            <div className={`${styles.skeletonLine} ${styles.skeletonWide}`} />
            <div className={`${styles.skeletonLine} ${styles.skeletonMed}`} />
            <div className={`${styles.skeletonLine} ${styles.skeletonWide}`} />
            <div className={`${styles.skeletonLine} ${styles.skeletonShort}`} />
            <div className={`${styles.skeletonLine} ${styles.skeletonWide}`} />
            <div className={`${styles.skeletonLine} ${styles.skeletonMed}`} />
          </div>
        </section>
      )}

      {/* Preview */}
      {preview && !generating && (
        <section className={styles.section} ref={previewRef}>
          <span className={styles.stepLabel}>Preview</span>
          <div className={styles.previewCard}>
            <div className={styles.previewHeader}>
              <span className={styles.previewIcon}>{preview.kind === 'slides' ? '📊' : '📄'}</span>
              <h3 className={styles.previewTitle}>{preview.title}</h3>
            </div>
            <div className={styles.previewBody}>
              {renderPreviewContent()}
            </div>
            <div className={styles.previewActions}>
              <button
                className={styles.primaryBtn}
                onClick={handleSaveToDrive}
                disabled={saving || !driveToken}
              >
                {saving ? 'Saving…' : `Save to Google ${preview.kind === 'slides' ? 'Slides' : 'Docs'}`}
              </button>
              <button
                className={styles.secondaryBtn}
                onClick={handleGenerate}
                disabled={generating}
              >
                Regenerate
              </button>
              <button className={styles.ghostBtn} onClick={() => setPreview(null)}>Discard</button>
            </div>
          </div>
        </section>
      )}

      {/* History */}
      {history.length > 0 && (
        <section className={styles.section}>
          <div className={styles.historyHeader}>
            <span className={styles.stepLabel}>Recent</span>
            <button className={styles.ghostBtn} onClick={clearHistory}>Clear</button>
          </div>
          <div className={styles.resultList}>
            {history.map(r => (
              <div key={r.id} className={styles.resultCard}>
                <span className={styles.resultIcon}>{r.kind === 'slides' ? '📊' : '📄'}</span>
                <div className={styles.resultInfo}>
                  <span className={styles.resultTitle}>{r.title}</span>
                  <span className={styles.resultStatus}>
                    {r.templateLabel} · {formatTimeAgo(r.createdAt)}
                  </span>
                </div>
                <a className={styles.openBtn} href={r.url} target="_blank" rel="noopener noreferrer">Open</a>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
