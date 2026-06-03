import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { storage } from '../../lib/storage';
import { useSubscription, hasAIAccess } from '../../lib/subscription';
import {
  CREATE_TEMPLATES, CreateTemplate, PreviewResult,
  CreateDocSpec, CreateSlidesSpec, CreateFlashcardSpec,
  generatePreview, savePreviewToDrive, parseCreateSlides,
} from '../../lib/aiArtifacts';
import { FlashcardDeck, saveDeck, newCard, loadDecks, deleteDeck, FLASHCARDS_EVENT } from '../../lib/flashcards';
import { Quiz, loadQuizzes, deleteQuiz, QUIZZES_EVENT } from '../../lib/quizzes';
import { readDriveFile } from '../../lib/googleDrive';
import { useGooglePicker, PickedFile } from '../../lib/useGooglePicker';
import { Attachment, fileToAttachment, UploadError, ACCEPT_ATTR } from '../../lib/uploads';
import { CanvasAssignment, Subject } from '../../types';
import { SavedCreation, loadCreateHistory, saveCreateHistory } from '../../lib/createHistory';
import {
  NativeCreation, loadNativeLibrary, saveNativeCreation, deleteNativeCreation, NATIVE_LIBRARY_EVENT,
} from '../../lib/nativeLibrary';
import {
  Layers, HelpCircle, FileText, Presentation,
  BookOpen, ListTree, AlignLeft,
} from 'lucide-react';
import FlashcardsMode from './FlashcardsMode';
import QuizzesMode from './QuizzesMode';
import styles from './CreateTab.module.css';

type SourceType = 'topic' | 'assignment' | 'subject' | 'file' | 'upload';
type Destination = 'soma' | 'google';
type BuildMethod = 'ai' | 'manual';
type TypeId = 'flashcards' | 'quiz' | 'notes' | 'slides' | 'studyguide' | 'outline' | 'summary';

const MAX_FILE_CHARS = 12_000;

// One box per kind of study material. Flashcards & Quiz can be built by hand
// (interactive, kept in Soma); they and the document types can also be
// generated with AI. The user picks the type first, then how/where.
const ICON_SIZE = 18;
const TYPE_DEFS: { id: TypeId; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'flashcards', label: 'Flashcards',    icon: <Layers size={ICON_SIZE} />,        desc: 'A deck you flip through and study' },
  { id: 'quiz',       label: 'Quiz',           icon: <HelpCircle size={ICON_SIZE} />,    desc: 'Questions you take and get scored on' },
  { id: 'notes',      label: 'Study Notes',    icon: <FileText size={ICON_SIZE} />,      desc: 'Clean, organized notes on a topic' },
  { id: 'slides',     label: 'Slide Deck',     icon: <Presentation size={ICON_SIZE} />,  desc: 'A presentation deck' },
  { id: 'studyguide', label: 'Study Guide',    icon: <BookOpen size={ICON_SIZE} />,      desc: 'Exam-focused review of key concepts' },
  { id: 'outline',    label: 'Essay Outline',  icon: <ListTree size={ICON_SIZE} />,      desc: 'Thesis, structure and evidence' },
  { id: 'summary',    label: 'Summarize',      icon: <AlignLeft size={ICON_SIZE} />,     desc: 'Condense material to the essentials' },
];

// ── Shared content renderer (used by preview + the in-app reader) ──────────────

function renderSpec(kind: 'doc' | 'slides' | 'flashcards', docSpec?: CreateDocSpec, slidesSpec?: CreateSlidesSpec, flashcardsSpec?: CreateFlashcardSpec) {
  if (kind === 'flashcards' && flashcardsSpec) {
    return (
      <div className={styles.previewFlashcards}>
        {flashcardsSpec.cards.map((card, i) => (
          <div key={i} className={styles.flashcardPreviewCard}>
            <span className={styles.flashcardNum}>{i + 1}</span>
            <div className={styles.flashcardContent}>
              <p className={styles.flashcardFront}>{card.front}</p>
              <p className={styles.flashcardBack}>{card.back}</p>
            </div>
          </div>
        ))}
      </div>
    );
  }
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

  const templatesById = useMemo(
    () => Object.fromEntries(CREATE_TEMPLATES.map(t => [t.id, t])) as Record<string, CreateTemplate>,
    [],
  );

  const [typeId, setTypeId] = useState<TypeId | null>(null);

  // Deep-link: Day View can launch a specific deck/quiz straight into study.
  const location = useLocation();
  const [launchStudyId, setLaunchStudyId] = useState<string | undefined>(undefined);
  useEffect(() => {
    const st = location.state as {
      study?: { tool: 'flashcards' | 'quiz'; id: string };
      make?: { tool: 'flashcards' | 'quiz' };
    } | null;
    if (st?.study) {
      setTypeId(st.study.tool);
      if (st.study.tool === 'quiz') setMethodSel('manual'); // native interactive quiz
      setLaunchStudyId(st.study.id);
      window.history.replaceState({}, '');
    } else if (st?.make) {
      setTypeId(st.make.tool);
      if (st.make.tool === 'quiz') setMethodSel('manual');
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  // How it's built (Write it myself / Generate with AI) and where it goes.
  const [methodSel, setMethodSel] = useState<BuildMethod | null>(null);
  const method: BuildMethod = methodSel ?? (aiAccess ? 'ai' : 'manual');
  const [destSel, setDestSel] = useState<Destination | null>(null);
  const destination: Destination = destSel ?? (aiAccess ? 'google' : 'soma');

  const [sourceType, setSourceType] = useState<SourceType>('topic');
  const [topic, setTopic] = useState('');
  const [assignmentId, setAssignmentId] = useState<number | null>(null);
  const [subjectId, setSubjectId] = useState<string>('');
  const [driveFile, setDriveFile] = useState<{ id: string; title: string } | null>(null);
  const [instructions, setInstructions] = useState('');

  // Uploaded file (photo / PDF) read in the browser — never stored server-side.
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [manualTitle, setManualTitle] = useState('');
  const [manualBody, setManualBody] = useState('');

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const [history, setHistory] = useState<SavedCreation[]>(loadCreateHistory);
  const [nativeItems, setNativeItems] = useState<NativeCreation[]>(loadNativeLibrary);
  const [decks, setDecks] = useState<FlashcardDeck[]>(loadDecks);
  const [quizzes, setQuizzes] = useState<Quiz[]>(loadQuizzes);
  const [viewer, setViewer] = useState<NativeCreation | null>(null);

  const previewRef = useRef<HTMLDivElement>(null);
  const topicRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const refreshNative = () => setNativeItems(loadNativeLibrary());
    const refreshDecks = () => setDecks(loadDecks());
    const refreshQuizzes = () => setQuizzes(loadQuizzes());
    window.addEventListener(NATIVE_LIBRARY_EVENT, refreshNative);
    window.addEventListener(FLASHCARDS_EVENT, refreshDecks);
    window.addEventListener(QUIZZES_EVENT, refreshQuizzes);
    return () => {
      window.removeEventListener(NATIVE_LIBRARY_EVENT, refreshNative);
      window.removeEventListener(FLASHCARDS_EVENT, refreshDecks);
      window.removeEventListener(QUIZZES_EVENT, refreshQuizzes);
    };
  }, []);

  function resetBuild() {
    setError(''); setPreview(null); setManualTitle(''); setManualBody('');
  }
  function pickType(id: TypeId) { setTypeId(id); resetBuild(); }

  // Interactive (native) when building flashcards by hand, or a hand-built quiz.
  const interactive = (typeId === 'flashcards' && method === 'manual') || (typeId === 'quiz' && method === 'manual');

  // The AI/document template backing the current type (null for interactive builds).
  const activeTemplate: CreateTemplate | null = !typeId
    ? null
    : typeId === 'flashcards'
      ? (method === 'ai' ? templatesById['flashcards'] : null)
      : typeId === 'quiz'
        ? (method === 'ai' ? templatesById['quiz'] : null)
        : templatesById[typeId] ?? null;

  function onPickFile(f: PickedFile) { setDriveFile({ id: f.id, title: f.name }); }
  const { openPicker } = useGooglePicker(driveToken, onPickFile);

  async function ingestFile(file: File | undefined | null) {
    if (!file) return;
    setError('');
    setUploadBusy(true);
    try {
      setAttachment(await fileToAttachment(file));
    } catch (e) {
      setError(e instanceof UploadError ? e.message : 'Could not read that file.');
    } finally {
      setUploadBusy(false);
    }
  }
  function onUploadDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    ingestFile(e.dataTransfer.files?.[0]);
  }
  function onUploadPaste(e: React.ClipboardEvent) {
    const file = Array.from(e.clipboardData.files)[0];
    if (file) { e.preventDefault(); ingestFile(file); }
  }

  const canGenerate = (() => {
    if (!activeTemplate || generating || saving) return false;
    if (sourceType === 'topic') return topic.trim().length > 1;
    if (sourceType === 'assignment') return assignmentId != null;
    if (sourceType === 'subject') return !!subjectId;
    if (sourceType === 'file') return !!driveFile;
    if (sourceType === 'upload') return !!attachment && !uploadBusy;
    return false;
  })();

  const buildSource = useCallback(async (): Promise<{ label: string; context: string }> => {
    if (sourceType === 'upload') return { label: attachment?.name ?? 'the uploaded file', context: '' };
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
  }, [sourceType, topic, assignments, assignmentId, subjects, subjectId, driveFile, driveToken, attachment]);

  async function handleGenerate() {
    if (!activeTemplate || !canGenerate) return;
    setGenerating(true);
    setError('');
    setPreview(null);
    try {
      const { label, context } = await buildSource();
      const result = await generatePreview({
        template: activeTemplate,
        sourceLabel: label,
        sourceContext: context,
        instructions,
        attachments: sourceType === 'upload' && attachment ? [attachment] : undefined,
      });
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

  async function persistToDrive(preview: PreviewResult): Promise<void> {
    const freshToken = storage.getGoogleDriveToken();
    if (!freshToken) { setError('Google Drive not connected — reconnect in Settings.'); throw new Error('no_token'); }
    const result = await savePreviewToDrive(preview, freshToken);
    const creation: SavedCreation = {
      id: crypto.randomUUID(),
      kind: result.kind,
      title: result.title,
      url: result.url,
      templateLabel: activeTemplate?.label || '',
      sourceLabel: sourceType === 'topic' ? topic.trim() : '',
      createdAt: new Date().toISOString(),
      subjectId: sourceType === 'subject' ? subjectId || undefined : undefined,
    };
    const updated = [creation, ...history];
    setHistory(updated);
    saveCreateHistory(updated);
  }

  function persistNative(preview: PreviewResult): void {
    saveNativeCreation({
      id: crypto.randomUUID(),
      kind: preview.kind,
      title: preview.title,
      templateLabel: activeTemplate?.label || '',
      subjectId: sourceType === 'subject' ? subjectId || undefined : undefined,
      createdAt: new Date().toISOString(),
      docSpec: preview.docSpec,
      slidesSpec: preview.slidesSpec,
    });
  }

  async function handleSavePreview() {
    if (!preview) return;
    // Flashcards always save as a native deck in Soma
    if (preview.kind === 'flashcards' && preview.flashcardsSpec) {
      const deck = {
        id: crypto.randomUUID(),
        title: preview.flashcardsSpec.title,
        subjectId: sourceType === 'subject' ? subjectId || undefined : undefined,
        cards: preview.flashcardsSpec.cards.map(c => ({
          ...newCard(),
          front: c.front,
          back: c.back,
        })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      saveDeck(deck);
      setPreview(null);
      return;
    }
    if (destination === 'soma') { persistNative(preview); setPreview(null); return; }
    setSaving(true); setError('');
    try {
      await persistToDrive(preview);
      setPreview(null);
    } catch (err: unknown) {
      const msg = err as Error;
      if (msg.message !== 'no_token') {
        setError(
          msg.message === 'google_token_expired' ? 'Google access expired — reconnect Google Drive in Settings.'
            : msg.message === 'subscription_required' ? 'Your subscription has expired.'
            : msg.message === 'auth_required' ? 'Please sign in again.'
            : msg.message === 'docs_error' || msg.message === 'slides_error' ? 'Google could not create the file — try reconnecting Google Drive in Settings.'
            : `Failed to save to Drive: ${msg.message}`,
        );
      }
    } finally {
      setSaving(false);
    }
  }

  // Build a doc/deck the user wrote by hand, then save to the chosen destination.
  async function handleSaveManual() {
    if (!activeTemplate) return;
    const title = manualTitle.trim();
    if (!title) { setError('Give it a title.'); return; }
    const body = manualBody.trim();
    if (!body) { setError('Add some content first.'); return; }

    let result: PreviewResult;
    if (activeTemplate.output === 'slides') {
      const spec = parseCreateSlides(`<createSlides title="${title.replace(/"/g, '')}">\n${body}\n</createSlides>`);
      if (!spec) { setError('Start each slide with "== " and each point with "- ".'); return; }
      result = { kind: 'slides', title, rawContent: body, slidesSpec: spec };
    } else {
      result = { kind: 'doc', title, rawContent: body, docSpec: { title, content: body } };
    }

    if (destination === 'soma') {
      persistNative(result);
      resetBuild();
      setTypeId(null);
      return;
    }
    setSaving(true); setError('');
    try {
      await persistToDrive(result);
      resetBuild();
      setTypeId(null);
    } catch (err: unknown) {
      const msg = err as Error;
      if (msg.message !== 'no_token') setError(`Failed to save to Drive: ${msg.message}`);
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

  function removeNative(id: string) { deleteNativeCreation(id); }
  function removeGoogle(id: string) {
    const updated = history.filter(h => h.id !== id);
    setHistory(updated);
    saveCreateHistory(updated);
  }

  useEffect(() => {
    if (activeTemplate && method === 'ai' && sourceType === 'topic') topicRef.current?.focus();
  }, [activeTemplate, method, sourceType]);

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
            {renderSpec(viewer.kind, viewer.docSpec, viewer.slidesSpec, undefined)}
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
    ...decks.map(d => ({ kind: 'deck' as const, item: d, createdAt: d.createdAt })),
    ...quizzes.map(q => ({ kind: 'quiz' as const, item: q, createdAt: q.createdAt })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const showDestination = !interactive && typeId !== 'flashcards'; // flashcards + interactive builds always live in Soma

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Create</h1>
        <p className={styles.subtitle}>Make flashcards, quizzes, notes and more — kept in Soma or saved to Google.</p>
      </header>

      {/* ── 1 · What to make (one box per type) ── */}
      <section className={styles.section}>
        <span className={styles.stepLabel}>1 · What do you want to make?</span>
        <div className={styles.templateGrid}>
          {TYPE_DEFS.map(t => {
            const tmpl = templatesById[t.id];
            const badge = t.id === 'flashcards' || t.id === 'quiz'
              ? 'Interactive'
              : tmpl?.output === 'slides' ? 'Slides' : 'Doc';
            return (
              <button
                key={t.id}
                className={`${styles.templateCard}${typeId === t.id ? ` ${styles.templateCardActive}` : ''}`}
                onClick={() => pickType(t.id)}
              >
                <span className={styles.templateIcon}>{t.icon}</span>
                <span className={styles.templateLabel}>{t.label}</span>
                <span className={styles.templateDesc}>{t.desc}</span>
                <span className={`${styles.templateBadge} ${badge === 'Slides' ? styles.templateBadgeSlides : ''}`}>{badge}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── 2 · How (and where) ── */}
      {typeId && (
        <section className={styles.section}>
          {typeId === 'flashcards' ? (
            <>
              <span className={styles.stepLabel}>2 · How do you want to build it?</span>
              <div className={styles.segment}>
                <button
                  className={`${styles.segBtn}${method === 'ai' ? ` ${styles.segBtnActive}` : ''}`}
                  onClick={() => { setMethodSel('ai'); resetBuild(); }}
                >Generate with AI · Premium</button>
                <button
                  className={`${styles.segBtn}${method === 'manual' ? ` ${styles.segBtnActive}` : ''}`}
                  onClick={() => { setMethodSel('manual'); resetBuild(); }}
                >Write it myself · Free</button>
              </div>

              {method === 'manual' ? (
                <FlashcardsMode subjects={subjects} initialStudyId={launchStudyId} />
              ) : !aiAccess ? (
                <div className={styles.gateCard}>
                  <h2 className={styles.gateTitle}>AI generation is part of Soma Premium</h2>
                  <p className={styles.gateText}>Switch to "Write it myself" to make flashcards free, or start a 3-week trial to generate with AI.</p>
                  <div className={styles.generateRow}>
                    <button className={styles.secondaryBtn} onClick={() => setMethodSel('manual')}>Write it myself</button>
                    <button className={styles.primaryBtn} onClick={() => navigate('/pricing')}>See plans</button>
                  </div>
                </div>
              ) : (
                <>
                  <span className={styles.stepLabel}>Based on what?</span>
                  <div className={styles.segment}>
                    {([['topic', 'Topic'], ['upload', 'Upload'], ['assignment', 'Assignment'], ['subject', 'Subject'], ['file', 'Drive file']] as [SourceType, string][]).map(([key, label]) => (
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
                        placeholder="e.g. Photosynthesis, the French Revolution, derivatives..."
                        value={topic}
                        onChange={e => setTopic(e.target.value)}
                        onKeyDown={handleKeyDown}
                      />
                    )}
                    {sourceType === 'upload' && (
                      attachment ? (
                        <div className={styles.fileRow}>
                          <span className={styles.fileChip}>{attachment.kind === 'pdf' ? '📄' : '🖼'} {attachment.name}</span>
                          <button className={styles.secondaryBtn} onClick={() => setAttachment(null)}>Remove</button>
                        </div>
                      ) : (
                        <div
                          className={`${styles.uploadZone}${dragActive ? ` ${styles.uploadZoneActive}` : ''}`}
                          onClick={() => fileInputRef.current?.click()}
                          onDragOver={e => { e.preventDefault(); setDragActive(true); }}
                          onDragLeave={() => setDragActive(false)}
                          onDrop={onUploadDrop}
                          onPaste={onUploadPaste}
                          tabIndex={0}
                          role="button"
                        >
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept={ACCEPT_ATTR}
                            hidden
                            onChange={e => { ingestFile(e.target.files?.[0]); e.target.value = ''; }}
                          />
                          <span className={styles.uploadIcon}>⬆</span>
                          <span className={styles.uploadTitle}>{uploadBusy ? 'Reading...' : 'Drop a photo or PDF, click to choose, or paste a screenshot'}</span>
                          <span className={styles.uploadHint}>Lecture slide, reading, or notes</span>
                        </div>
                      )
                    )}
                    {sourceType === 'assignment' && (
                      assignments.length > 0 ? (
                        <select className={styles.input} value={assignmentId ?? ''} onChange={e => setAssignmentId(e.target.value ? Number(e.target.value) : null)}>
                          <option value="">Choose an assignment...</option>
                          {assignments.map(a => <option key={a.id} value={a.id}>{a.name} — {a.courseName}</option>)}
                        </select>
                      ) : <span className={styles.emptyNote}>No Canvas assignments synced. Connect Canvas first.</span>
                    )}
                    {sourceType === 'subject' && (
                      subjects.length > 0 ? (
                        <select className={styles.input} value={subjectId} onChange={e => setSubjectId(e.target.value)}>
                          <option value="">Choose a subject...</option>
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
                    placeholder="Extra instructions (optional) — e.g. focus on chapters 3-4, keep it concise, AP-level..."
                    value={instructions}
                    onChange={e => setInstructions(e.target.value)}
                    rows={2}
                  />

                  <div className={styles.generateRow}>
                    <button className={styles.primaryBtn} onClick={handleGenerate} disabled={!canGenerate}>
                      {generating ? 'Generating...' : preview ? 'Regenerate' : 'Generate Flashcards'}
                    </button>
                    {error && <span className={styles.error}>{error}</span>}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <span className={styles.stepLabel}>2 · How do you want to build it?</span>
              <div className={styles.segment}>
                <button
                  className={`${styles.segBtn}${method === 'ai' ? ` ${styles.segBtnActive}` : ''}`}
                  onClick={() => { setMethodSel('ai'); resetBuild(); }}
                >Generate with AI · Premium</button>
                <button
                  className={`${styles.segBtn}${method === 'manual' ? ` ${styles.segBtnActive}` : ''}`}
                  onClick={() => { setMethodSel('manual'); resetBuild(); }}
                >Write it myself · Free</button>
              </div>

              {/* Destination — chosen before any content is made (document outputs only) */}
              {showDestination && (
                <>
                  <div className={styles.segment}>
                    <button
                      className={`${styles.segBtn}${destination === 'soma' ? ` ${styles.segBtnActive}` : ''}`}
                      onClick={() => { setDestSel('soma'); resetBuild(); }}
                    >📱 Keep in Soma</button>
                    <button
                      className={`${styles.segBtn}${destination === 'google' ? ` ${styles.segBtnActive}` : ''}`}
                      onClick={() => { setDestSel('google'); resetBuild(); }}
                    >📄 Google {activeTemplate?.output === 'slides' ? 'Slides' : 'Docs'}</button>
                  </div>
                  <p className={styles.destNote}>
                    {destination === 'soma'
                      ? 'Stays inside the app — no Google account needed.'
                      : 'Creates a real file in your Google Drive.'}
                  </p>
                  {destination === 'google' && !driveToken && (
                    <div className={styles.banner}>
                      <span>Connect Google Drive to create Docs and Slides.</span>
                      <button className={styles.bannerBtn} onClick={() => navigate('/settings')}>Connect</button>
                    </div>
                  )}
                </>
              )}

              {/* ── Interactive native quiz (manual) ── */}
              {interactive ? (
                <QuizzesMode subjects={subjects} initialStudyId={launchStudyId} />
              ) : method === 'manual' ? (
                // ── Manual document authoring (free) ──
                <div className={styles.sourceInput}>
                  <input
                    className={styles.input}
                    placeholder={`${activeTemplate?.label ?? ''} title`}
                    value={manualTitle}
                    onChange={e => setManualTitle(e.target.value)}
                  />
                  <textarea
                    className={styles.textarea}
                    placeholder={activeTemplate?.output === 'slides'
                      ? 'One slide per "== Title" line, one point per "- bullet" line:\n== Overview\n- First point\n- Second point'
                      : 'Write your content. Use **bold** for emphasis, "- " for bullets, and put headings on their own line.'}
                    value={manualBody}
                    onChange={e => setManualBody(e.target.value)}
                    rows={10}
                  />
                  <div className={styles.generateRow}>
                    <button
                      className={styles.primaryBtn}
                      onClick={handleSaveManual}
                      disabled={!manualTitle.trim() || !manualBody.trim() || saving || (destination === 'google' && !driveToken)}
                    >
                      {saving ? 'Saving…' : destination === 'soma' ? 'Keep in Soma' : `Save to Google ${activeTemplate?.output === 'slides' ? 'Slides' : 'Docs'}`}
                    </button>
                    {error && <span className={styles.error}>{error}</span>}
                  </div>
                </div>
              ) : !aiAccess ? (
                // ── AI gated (free user chose AI) ──
                <div className={styles.gateCard}>
                  <h2 className={styles.gateTitle}>AI generation is part of Soma Premium</h2>
                  <p className={styles.gateText}>Switch to “Write it myself” to make it free, or start a 3-week trial to generate with AI.</p>
                  <div className={styles.generateRow}>
                    <button className={styles.secondaryBtn} onClick={() => setMethodSel('manual')}>Write it myself</button>
                    <button className={styles.primaryBtn} onClick={() => navigate('/pricing')}>See plans</button>
                  </div>
                </div>
              ) : (
                // ── AI generation (premium) ──
                <>
                  <span className={styles.stepLabel}>Based on what?</span>
                  <div className={styles.segment}>
                    {([['topic', 'Topic'], ['upload', 'Upload'], ['assignment', 'Assignment'], ['subject', 'Subject'], ['file', 'Drive file']] as [SourceType, string][]).map(([key, label]) => (
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
                    {sourceType === 'upload' && (
                      attachment ? (
                        <div className={styles.fileRow}>
                          <span className={styles.fileChip}>{attachment.kind === 'pdf' ? '📄' : '🖼'} {attachment.name}</span>
                          <button className={styles.secondaryBtn} onClick={() => setAttachment(null)}>Remove</button>
                        </div>
                      ) : (
                        <div
                          className={`${styles.uploadZone}${dragActive ? ` ${styles.uploadZoneActive}` : ''}`}
                          onClick={() => fileInputRef.current?.click()}
                          onDragOver={e => { e.preventDefault(); setDragActive(true); }}
                          onDragLeave={() => setDragActive(false)}
                          onDrop={onUploadDrop}
                          onPaste={onUploadPaste}
                          tabIndex={0}
                          role="button"
                        >
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept={ACCEPT_ATTR}
                            hidden
                            onChange={e => { ingestFile(e.target.files?.[0]); e.target.value = ''; }}
                          />
                          <span className={styles.uploadIcon}>⬆</span>
                          <span className={styles.uploadTitle}>{uploadBusy ? 'Reading…' : 'Drop a photo or PDF, click to choose, or paste a screenshot'}</span>
                          <span className={styles.uploadHint}>Lecture slide, reading, or notes · JPG, PNG, WebP, PDF</span>
                        </div>
                      )
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
                      {generating ? 'Generating…' : preview ? 'Regenerate' : `Generate ${activeTemplate?.output === 'slides' ? 'Slides' : 'Doc'}`}
                    </button>
                    {error && <span className={styles.error}>{error}</span>}
                  </div>
                </>
              )}
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
              <span className={styles.previewIcon}>{preview.kind === 'flashcards' ? <Layers size={16} /> : preview.kind === 'slides' ? <Presentation size={16} /> : <FileText size={16} />}</span>
              <h3 className={styles.previewTitle}>{preview.title}{preview.kind === 'flashcards' && preview.flashcardsSpec ? ` (${preview.flashcardsSpec.cards.length} cards)` : ''}</h3>
            </div>
            <div className={styles.previewBody}>{renderSpec(preview.kind, preview.docSpec, preview.slidesSpec, preview.flashcardsSpec)}</div>
            <div className={styles.previewActions}>
              <button className={styles.primaryBtn} onClick={handleSavePreview} disabled={saving || (preview.kind !== 'flashcards' && destination === 'google' && !driveToken)}>
                {saving ? 'Saving...' : preview.kind === 'flashcards' ? 'Save Deck' : destination === 'soma' ? 'Keep in Soma' : `Save to Google ${preview.kind === 'slides' ? 'Slides' : 'Docs'}`}
              </button>
              <button className={styles.secondaryBtn} onClick={handleGenerate} disabled={generating}>Regenerate</button>
              <button className={styles.ghostBtn} onClick={() => setPreview(null)}>Discard</button>
            </div>
          </div>
        </section>
      )}

      {/* Library — decks, quizzes, native docs, and Google items */}
      {recent.length > 0 && (
        <section className={styles.section}>
          <span className={styles.stepLabel}>Library</span>
          <div className={styles.resultList}>
            {recent.map(entry => {
              if (entry.kind === 'deck') {
                const deck = entry.item as FlashcardDeck;
                return (
                  <div key={deck.id} className={styles.resultCard}>
                    <span className={styles.resultIcon}><Layers size={14} /></span>
                    <div className={styles.resultInfo}>
                      <span className={styles.resultTitle}>{deck.title || 'Untitled deck'}</span>
                      <span className={styles.resultStatus}>Flashcards · {deck.cards.length} card{deck.cards.length === 1 ? '' : 's'} · {formatTimeAgo(deck.createdAt)}</span>
                    </div>
                    <button className={styles.openBtn} onClick={() => { setTypeId('flashcards'); setMethodSel('manual'); setLaunchStudyId(deck.id); }}>Study</button>
                    <button className={styles.ghostBtn} onClick={() => { if (confirm('Delete this deck?')) deleteDeck(deck.id); }}>Delete</button>
                  </div>
                );
              }
              if (entry.kind === 'quiz') {
                const quiz = entry.item as Quiz;
                return (
                  <div key={quiz.id} className={styles.resultCard}>
                    <span className={styles.resultIcon}><HelpCircle size={14} /></span>
                    <div className={styles.resultInfo}>
                      <span className={styles.resultTitle}>{quiz.title || 'Untitled quiz'}</span>
                      <span className={styles.resultStatus}>Quiz · {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'} · {formatTimeAgo(quiz.createdAt)}</span>
                    </div>
                    <button className={styles.openBtn} onClick={() => { setTypeId('quiz'); setMethodSel('manual'); setLaunchStudyId(quiz.id); }}>Take</button>
                    <button className={styles.ghostBtn} onClick={() => { if (confirm('Delete this quiz?')) deleteQuiz(quiz.id); }}>Delete</button>
                  </div>
                );
              }
              if (entry.kind === 'native') {
                return (
                  <div key={entry.item.id} className={styles.resultCard}>
                    <span className={styles.resultIcon}>{entry.item.kind === 'slides' ? <Presentation size={14} /> : <FileText size={14} />}</span>
                    <div className={styles.resultInfo}>
                      <span className={styles.resultTitle}>{entry.item.title}</span>
                      <span className={styles.resultStatus}>In Soma · {(entry.item as NativeCreation).templateLabel} · {formatTimeAgo(entry.item.createdAt)}</span>
                    </div>
                    <button className={styles.openBtn} onClick={() => setViewer(entry.item as NativeCreation)}>Open</button>
                    <button className={styles.ghostBtn} onClick={() => removeNative(entry.item.id)}>Delete</button>
                  </div>
                );
              }
              // Google
              return (
                <div key={entry.item.id} className={styles.resultCard}>
                  <span className={styles.resultIcon}>{entry.item.kind === 'slides' ? <Presentation size={14} /> : <FileText size={14} />}</span>
                  <div className={styles.resultInfo}>
                    <span className={styles.resultTitle}>{entry.item.title}</span>
                    <span className={styles.resultStatus}>Google · {(entry.item as SavedCreation).templateLabel} · {formatTimeAgo(entry.item.createdAt)}</span>
                  </div>
                  <a className={styles.openBtn} href={(entry.item as SavedCreation).url} target="_blank" rel="noopener noreferrer">Open</a>
                  <button className={styles.ghostBtn} onClick={() => removeGoogle(entry.item.id)}>Delete</button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
