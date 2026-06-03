import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { storage } from '../../lib/storage';
import { useSubscription, hasAIAccess } from '../../lib/subscription';
import {
  CREATE_TEMPLATES, CreateTemplate, PreviewResult,
  CreateDocSpec, CreateSlidesSpec,
  generatePreview, savePreviewToDrive, parseCreateSlides,
} from '../../lib/aiArtifacts';
import { readDriveFile } from '../../lib/googleDrive';
import { useGooglePicker, PickedFile } from '../../lib/useGooglePicker';
import { CanvasAssignment, Subject } from '../../types';
import { SavedCreation, loadCreateHistory, saveCreateHistory } from '../../lib/createHistory';
import {
  NativeCreation, loadNativeLibrary, saveNativeCreation, deleteNativeCreation, NATIVE_LIBRARY_EVENT,
} from '../../lib/nativeLibrary';
import FlashcardsMode from './FlashcardsMode';
import QuizzesMode from './QuizzesMode';
import styles from './CreateTab.module.css';

type SourceType = 'topic' | 'assignment' | 'subject' | 'file';
type Destination = 'soma' | 'google';
type BuildMethod = 'ai' | 'manual';
type NativeTool = 'flashcards' | 'quiz';

const MAX_FILE_CHARS = 12_000;

// ── Shared content renderer (used by preview + the in-app reader) ──────────────

function renderSpec(kind: 'doc' | 'slides', docSpec?: CreateDocSpec, slidesSpec?: CreateSlidesSpec) {
  if (kind === 'slides' && slidesSpec) {
    return (
      <div className={styles.previewSlides}>
        {slidesSpec.slides.map((slide, i) => (
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
  if (docSpec) {
    return (
      <div className={styles.previewDoc}>
        {docSpec.content.split('\n').map((line, i) => {
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

export default function CreateTab() {
  const navigate = useNavigate();
  const subscription = useSubscription();
  const driveToken = storage.getGoogleDriveToken();
  const aiAccess = hasAIAccess(subscription.status);

  const assignments = useMemo<CanvasAssignment[]>(() => {
    return [...storage.getCachedAssignments()].sort(
      (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
    );
  }, []);
  const subjects = useMemo<Subject[]>(() => storage.getSubjects().filter(s => !s.archived), []);

  // ── Destination is chosen first. Default: subscribers → Google, free → Soma.
  const [destination, setDestination] = useState<Destination | null>(null);
  const dest: Destination = destination ?? (aiAccess ? 'google' : 'soma');

  // Build method only varies for the in-Soma path; Google export uses AI.
  const [methodSel, setMethodSel] = useState<BuildMethod | null>(null);
  const buildMethod: BuildMethod = dest === 'google'
    ? 'ai'
    : (methodSel ?? (aiAccess ? 'ai' : 'manual'));

  const [template, setTemplate] = useState<CreateTemplate | null>(null);
  const [nativeTool, setNativeTool] = useState<NativeTool | null>(null);
  const [sourceType, setSourceType] = useState<SourceType>('topic');
  const [topic, setTopic] = useState('');
  const [assignmentId, setAssignmentId] = useState<number | null>(null);
  const [subjectId, setSubjectId] = useState<string>('');
  const [driveFile, setDriveFile] = useState<{ id: string; title: string } | null>(null);
  const [instructions, setInstructions] = useState('');

  // Manual authoring
  const [manualTitle, setManualTitle] = useState('');
  const [manualBody, setManualBody] = useState('');

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const [history, setHistory] = useState<SavedCreation[]>(loadCreateHistory);
  const [nativeItems, setNativeItems] = useState<NativeCreation[]>(loadNativeLibrary);
  const [viewer, setViewer] = useState<NativeCreation | null>(null);

  const previewRef = useRef<HTMLDivElement>(null);
  const topicRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const refresh = () => setNativeItems(loadNativeLibrary());
    window.addEventListener(NATIVE_LIBRARY_EVENT, refresh);
    return () => window.removeEventListener(NATIVE_LIBRARY_EVENT, refresh);
  }, []);

  function resetBuild() { setError(''); setPreview(null); }

  function chooseDestination(d: Destination) {
    setDestination(d);
    resetBuild();
    if (d === 'google' && nativeTool) setNativeTool(null); // native tools are Soma-only
  }

  function pickTemplate(t: CreateTemplate) {
    setTemplate(t);
    setNativeTool(null);
    resetBuild();
    setManualBody('');
    setManualTitle('');
  }

  function pickNative(tool: NativeTool) {
    setNativeTool(tool);
    setTemplate(null);
    resetBuild();
  }

  function onPickFile(f: PickedFile) { setDriveFile({ id: f.id, title: f.name }); }
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
    if (sourceType === 'topic') return { label: topic.trim(), context: '' };
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
      const result = await generatePreview({ template, sourceLabel: label, sourceContext: context, instructions });
      setPreview(result);
      setTimeout(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (err: unknown) {
      const msg = err as Error;
      setError(
        msg.message === 'google_token_expired' ? 'Google access expired — reconnect Google Drive in Settings.'
          : msg.message === 'no_access' ? "Can't read that file — make sure it's shared with your Google account."
          : msg.message === 'generation_failed' ? 'The AI could not produce usable content. Try rephrasing or adding instructions.'
          : msg.message === 'subscription_required' ? 'Your subscription has expired. Visit Settings → Subscription.'
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setGenerating(false);
    }
  }

  // Save the current AI preview to the chosen destination.
  async function handleSavePreview() {
    if (!preview) return;
    if (dest === 'soma') {
      saveNativeCreation({
        id: crypto.randomUUID(),
        kind: preview.kind,
        title: preview.title,
        templateLabel: template?.label || '',
        subjectId: sourceType === 'subject' ? subjectId || undefined : undefined,
        createdAt: new Date().toISOString(),
        docSpec: preview.docSpec,
        slidesSpec: preview.slidesSpec,
      });
      setPreview(null);
      return;
    }
    // Google Drive export
    const freshToken = storage.getGoogleDriveToken();
    if (!freshToken) { setError('Google Drive not connected — reconnect in Settings.'); return; }
    setSaving(true);
    setError('');
    try {
      const result = await savePreviewToDrive(preview, freshToken);
      const creation: SavedCreation = {
        id: crypto.randomUUID(),
        kind: result.kind,
        title: result.title,
        url: result.url,
        templateLabel: template?.label || '',
        sourceLabel: sourceType === 'topic' ? topic.trim() : '',
        createdAt: new Date().toISOString(),
        subjectId: sourceType === 'subject' ? subjectId || undefined : undefined,
      };
      const updated = [creation, ...history];
      setHistory(updated);
      saveCreateHistory(updated);
      setPreview(null);
    } catch (err: unknown) {
      const msg = err as Error;
      setError(
        msg.message === 'google_token_expired' ? 'Google access expired — reconnect Google Drive in Settings.'
          : msg.message === 'subscription_required' ? 'Your subscription has expired.'
          : msg.message === 'auth_required' ? 'Please sign in again.'
          : msg.message === 'docs_error' || msg.message === 'slides_error' ? 'Google could not create the file — try reconnecting Google Drive in Settings.'
          : `Failed to save to Drive: ${msg.message}`,
      );
    } finally {
      setSaving(false);
    }
  }

  // Save a manually-written doc/deck natively (no AI, no Google).
  function handleSaveManual() {
    if (!template) return;
    const title = manualTitle.trim();
    if (!title) { setError('Give it a title.'); return; }
    const body = manualBody.trim();
    if (!body) { setError('Add some content first.'); return; }

    if (template.output === 'slides') {
      const spec = parseCreateSlides(`<createSlides title="${title.replace(/"/g, '')}">\n${body}\n</createSlides>`);
      if (!spec) { setError('Start each slide with "== " and each point with "- ".'); return; }
      saveNativeCreation({
        id: crypto.randomUUID(), kind: 'slides', title, templateLabel: template.label,
        subjectId: undefined, createdAt: new Date().toISOString(), slidesSpec: spec,
      });
    } else {
      saveNativeCreation({
        id: crypto.randomUUID(), kind: 'doc', title, templateLabel: template.label,
        subjectId: undefined, createdAt: new Date().toISOString(), docSpec: { title, content: body },
      });
    }
    setManualTitle('');
    setManualBody('');
    setError('');
    setTemplate(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && canGenerate && !preview) {
      e.preventDefault();
      handleGenerate();
    }
  }

  function removeNative(id: string) { deleteNativeCreation(id); }
  function removeGoogle(id: string) {
    const updated = history.filter(h => h.id !== id);
    setHistory(updated);
    saveCreateHistory(updated);
  }

  useEffect(() => {
    if (template && buildMethod === 'ai' && sourceType === 'topic') topicRef.current?.focus();
  }, [template, buildMethod, sourceType]);

  // ── In-app reader (native item) ──────────────────────────────────────────────
  if (viewer) {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
          <button className={styles.backLink} onClick={() => setViewer(null)}>← Library</button>
          <h1 className={styles.title}>{viewer.title}</h1>
          <p className={styles.subtitle}>{viewer.templateLabel} · kept in Soma</p>
        </header>
        <div className={styles.previewCard}>
          <div className={styles.previewBody}>
            {renderSpec(viewer.kind, viewer.docSpec, viewer.slidesSpec)}
          </div>
        </div>
      </div>
    );
  }

  if (subscription.status === 'loading') {
    return <div className={styles.container}><div className={styles.gateCard}>Loading…</div></div>;
  }

  const recent = [
    ...nativeItems.map(n => ({ kind: 'native' as const, item: n, createdAt: n.createdAt })),
    ...history.map(h => ({ kind: 'google' as const, item: h, createdAt: h.createdAt })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Create</h1>
        <p className={styles.subtitle}>
          {dest === 'soma'
            ? 'Build study materials and keep them right here in Soma.'
            : 'Generate study materials and save them to Google Drive.'}
        </p>
      </header>

      {/* ── Destination — decided first ── */}
      <section className={styles.section}>
        <span className={styles.stepLabel}>1 · Where should it go?</span>
        <div className={styles.segment}>
          <button
            className={`${styles.segBtn}${dest === 'soma' ? ` ${styles.segBtnActive}` : ''}`}
            onClick={() => chooseDestination('soma')}
          >📱 Keep in Soma</button>
          <button
            className={`${styles.segBtn}${dest === 'google' ? ` ${styles.segBtnActive}` : ''}`}
            onClick={() => chooseDestination('google')}
          >📄 Google Docs / Slides</button>
        </div>
        <p className={styles.destNote}>
          {dest === 'soma'
            ? 'Stays inside the app — view and study it here. No Google account needed.'
            : 'Creates a real Google Doc or Slides file in your Drive.'}
        </p>
      </section>

      {dest === 'google' && !driveToken && (
        <div className={styles.banner}>
          <span>Connect Google Drive to create Docs and Slides.</span>
          <button className={styles.bannerBtn} onClick={() => navigate('/settings')}>Connect</button>
        </div>
      )}

      {/* ── What to make ── */}
      <section className={styles.section}>
        <span className={styles.stepLabel}>2 · What do you want to make?</span>
        <div className={styles.templateGrid}>
          {dest === 'soma' && (
            <button
              className={`${styles.templateCard}${nativeTool === 'flashcards' ? ` ${styles.templateCardActive}` : ''}`}
              onClick={() => pickNative('flashcards')}
            >
              <span className={styles.templateIcon}>📇</span>
              <span className={styles.templateLabel}>Flashcards</span>
              <span className={styles.templateDesc}>Build a deck and study it in the app</span>
              <span className={styles.templateBadge}>In Soma</span>
            </button>
          )}
          {dest === 'soma' && (
            <button
              className={`${styles.templateCard}${nativeTool === 'quiz' ? ` ${styles.templateCardActive}` : ''}`}
              onClick={() => pickNative('quiz')}
            >
              <span className={styles.templateIcon}>🧠</span>
              <span className={styles.templateLabel}>Quiz</span>
              <span className={styles.templateDesc}>Write questions and take them, scored instantly</span>
              <span className={styles.templateBadge}>In Soma</span>
            </button>
          )}
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

      {/* ── Native tools (self-contained, in-app) ── */}
      {nativeTool === 'flashcards' && (
        <section className={styles.section}>
          <FlashcardsMode subjects={subjects} />
        </section>
      )}
      {nativeTool === 'quiz' && (
        <section className={styles.section}>
          <QuizzesMode subjects={subjects} />
        </section>
      )}

      {/* ── Doc / slides build ── */}
      {template && (
        <section className={styles.section}>
          {/* Method toggle (Soma path can be AI or manual; Google export uses AI) */}
          {dest === 'soma' && (
            <div className={styles.segment}>
              <button
                className={`${styles.segBtn}${buildMethod === 'ai' ? ` ${styles.segBtnActive}` : ''}`}
                onClick={() => { setMethodSel('ai'); resetBuild(); }}
              >✨ Generate with AI</button>
              <button
                className={`${styles.segBtn}${buildMethod === 'manual' ? ` ${styles.segBtnActive}` : ''}`}
                onClick={() => { setMethodSel('manual'); resetBuild(); }}
              >✍️ Write it myself</button>
            </div>
          )}

          {buildMethod === 'manual' ? (
            // ── Manual authoring (free, native) ──
            <div className={styles.sourceInput}>
              <input
                className={styles.input}
                placeholder={`${template.label} title`}
                value={manualTitle}
                onChange={e => setManualTitle(e.target.value)}
              />
              <textarea
                className={styles.textarea}
                placeholder={template.output === 'slides'
                  ? 'One slide per "== Title" line, one point per "- bullet" line:\n== Overview\n- First point\n- Second point'
                  : 'Write your content. Use **bold** for emphasis, "- " for bullets, and put headings on their own line.'}
                value={manualBody}
                onChange={e => setManualBody(e.target.value)}
                rows={10}
              />
              <div className={styles.generateRow}>
                <button className={styles.primaryBtn} onClick={handleSaveManual} disabled={!manualTitle.trim() || !manualBody.trim()}>
                  Save in Soma
                </button>
                {error && <span className={styles.error}>{error}</span>}
              </div>
            </div>
          ) : !aiAccess ? (
            // ── AI gated (free user chose AI) ──
            <div className={styles.gateCard}>
              <h2 className={styles.gateTitle}>AI generation is part of Soma Premium</h2>
              <p className={styles.gateText}>
                {dest === 'soma'
                  ? 'Switch to “Write it myself” to build it free, or start a trial to generate with AI.'
                  : 'Start your 3-week free trial to generate and export with AI.'}
              </p>
              <div className={styles.generateRow}>
                {dest === 'soma' && (
                  <button className={styles.secondaryBtn} onClick={() => setMethodSel('manual')}>Write it myself</button>
                )}
                <button className={styles.primaryBtn} onClick={() => navigate('/pricing')}>See plans</button>
              </div>
            </div>
          ) : (
            // ── AI generation (premium) ──
            <>
              <span className={styles.stepLabel}>Based on what?</span>
              <div className={styles.segment}>
                {([['topic', 'Topic'], ['assignment', 'Assignment'], ['subject', 'Subject'], ['file', 'Drive file']] as [SourceType, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    className={`${styles.segBtn}${sourceType === key ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => { setSourceType(key); resetBuild(); }}
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
                    <select className={styles.input} value={assignmentId ?? ''} onChange={e => setAssignmentId(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Choose an assignment…</option>
                      {assignments.map(a => <option key={a.id} value={a.id}>{a.name} — {a.courseName}</option>)}
                    </select>
                  ) : <span className={styles.emptyNote}>No Canvas assignments synced. Connect Canvas first.</span>
                )}
                {sourceType === 'subject' && (
                  subjects.length > 0 ? (
                    <select className={styles.input} value={subjectId} onChange={e => setSubjectId(e.target.value)}>
                      <option value="">Choose a subject…</option>
                      {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  ) : <span className={styles.emptyNote}>No subjects yet.</span>
                )}
                {sourceType === 'file' && (
                  driveToken ? (
                    <div className={styles.fileRow}>
                      <button className={styles.secondaryBtn} onClick={() => openPicker()}>{driveFile ? 'Change file' : 'Choose from Drive'}</button>
                      {driveFile && <span className={styles.fileChip}>{driveFile.title}</span>}
                    </div>
                  ) : <span className={styles.emptyNote}>Connect Google Drive to attach a file.</span>
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
            </>
          )}
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
          </div>
        </section>
      )}

      {/* Preview (AI) — save respects the chosen destination */}
      {preview && !generating && (
        <section className={styles.section} ref={previewRef}>
          <span className={styles.stepLabel}>Preview</span>
          <div className={styles.previewCard}>
            <div className={styles.previewHeader}>
              <span className={styles.previewIcon}>{preview.kind === 'slides' ? '📊' : '📄'}</span>
              <h3 className={styles.previewTitle}>{preview.title}</h3>
            </div>
            <div className={styles.previewBody}>{renderSpec(preview.kind, preview.docSpec, preview.slidesSpec)}</div>
            <div className={styles.previewActions}>
              <button className={styles.primaryBtn} onClick={handleSavePreview} disabled={saving || (dest === 'google' && !driveToken)}>
                {saving ? 'Saving…' : dest === 'soma' ? 'Keep in Soma' : `Save to Google ${preview.kind === 'slides' ? 'Slides' : 'Docs'}`}
              </button>
              <button className={styles.secondaryBtn} onClick={handleGenerate} disabled={generating}>Regenerate</button>
              <button className={styles.ghostBtn} onClick={() => setPreview(null)}>Discard</button>
            </div>
          </div>
        </section>
      )}

      {/* Library / Recent — native items open in-app, Google items open the link */}
      {recent.length > 0 && (
        <section className={styles.section}>
          <span className={styles.stepLabel}>Library</span>
          <div className={styles.resultList}>
            {recent.map(entry => entry.kind === 'native' ? (
              <div key={entry.item.id} className={styles.resultCard}>
                <span className={styles.resultIcon}>{entry.item.kind === 'slides' ? '📊' : '📝'}</span>
                <div className={styles.resultInfo}>
                  <span className={styles.resultTitle}>{entry.item.title}</span>
                  <span className={styles.resultStatus}>In Soma · {entry.item.templateLabel} · {formatTimeAgo(entry.item.createdAt)}</span>
                </div>
                <button className={styles.openBtn} onClick={() => setViewer(entry.item as NativeCreation)}>Open</button>
                <button className={styles.ghostBtn} onClick={() => removeNative(entry.item.id)}>Delete</button>
              </div>
            ) : (
              <div key={entry.item.id} className={styles.resultCard}>
                <span className={styles.resultIcon}>{entry.item.kind === 'slides' ? '📊' : '📄'}</span>
                <div className={styles.resultInfo}>
                  <span className={styles.resultTitle}>{entry.item.title}</span>
                  <span className={styles.resultStatus}>Google · {(entry.item as SavedCreation).templateLabel} · {formatTimeAgo(entry.item.createdAt)}</span>
                </div>
                <a className={styles.openBtn} href={(entry.item as SavedCreation).url} target="_blank" rel="noopener noreferrer">Open</a>
                <button className={styles.ghostBtn} onClick={() => removeGoogle(entry.item.id)}>Delete</button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
