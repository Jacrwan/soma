import { useEffect, useMemo, useRef, useState } from 'react';
import { storage } from '../../lib/storage';
import { Subject, SomaDocument, DocumentType } from '../../types';
import {
  listDocuments, uploadDocument, updateDocument, deleteDocument, getDocumentUrl,
  extractDocumentText, DocumentError, ACCEPT_ATTR, DOCUMENT_TYPES,
} from '../../lib/documents';
import styles from './DocumentsTab.module.css';

type LoadState = 'loading' | 'ready' | 'not_set_up' | 'error';

function extLabel(fileName: string, fileType: string): string {
  const fromName = fileName.split('.').pop();
  if (fromName && fromName.length <= 5) return fromName.toUpperCase();
  return fileType.split('/').pop()?.slice(0, 5).toUpperCase() ?? 'FILE';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function DocumentsTab() {
  const [subjects, setSubjects] = useState<Subject[]>(() => storage.getSubjects().filter(s => !s.archived));
  const [docs, setDocs] = useState<SomaDocument[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [actionError, setActionError] = useState('');

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<DocumentType | 'all'>('all');
  const [subjectFilter, setSubjectFilter] = useState<'all' | 'unassigned' | string>('all');

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState<'file' | 'paste'>('file');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteContent, setPasteContent] = useState('');
  const [uploadSubjectId, setUploadSubjectId] = useState<string>('');
  const [uploadType, setUploadType] = useState<DocumentType>('other');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    load();
    const onSubjectsChanged = () => setSubjects(storage.getSubjects().filter(s => !s.archived));
    window.addEventListener('soma_subjects_changed', onSubjectsChanged);
    // getSubjects() reads an in-memory list populated asynchronously by
    // loadTokens(). If this page mounts before that resolves, the initial
    // useState can capture an empty list even though subjects genuinely
    // exist — re-check once loading settles.
    let cancelled = false;
    storage.whenTokensLoaded().then(() => {
      if (!cancelled) setSubjects(storage.getSubjects().filter(s => !s.archived));
    });
    return () => {
      cancelled = true;
      window.removeEventListener('soma_subjects_changed', onSubjectsChanged);
    };
  }, []);

  async function load() {
    setState('loading');
    try {
      const fetched = await listDocuments();
      setDocs(fetched);
      setState('ready');
      // Pick up any document whose extraction never ran (e.g. the tab closed
      // right after upload) or is still mid-flight from a previous visit.
      const stuck = fetched.filter(d => d.extractionStatus === 'pending' || d.extractionStatus === 'processing');
      if (stuck.length > 0) {
        void Promise.all(stuck.map(d => extractDocumentText(d))).then(() => {
          void listDocuments().then(setDocs).catch(() => {});
        });
      }
    } catch (e) {
      if (e instanceof DocumentError && e.message === 'not_set_up') {
        setState('not_set_up');
      } else {
        setState('error');
      }
    }
  }

  const subjectById = useMemo(() => new Map(subjects.map(s => [s.id, s])), [subjects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter(d => {
      if (q && !d.fileName.toLowerCase().includes(q)) return false;
      if (typeFilter !== 'all' && d.docType !== typeFilter) return false;
      if (subjectFilter === 'unassigned' && d.subjectId) return false;
      if (subjectFilter !== 'all' && subjectFilter !== 'unassigned' && d.subjectId !== subjectFilter) return false;
      return true;
    });
  }, [docs, search, typeFilter, subjectFilter]);

  function openUploadModal() {
    setUploadMode('file');
    setUploadFile(null);
    setPasteTitle('');
    setPasteContent('');
    setUploadSubjectId('');
    setUploadType('other');
    setActionError('');
    setUploadOpen(true);
  }

  async function handleUpload() {
    let fileToUpload: File | null = uploadFile;
    if (uploadMode === 'paste') {
      const title = pasteTitle.trim();
      const content = pasteContent;
      if (!title || !content.trim()) return;
      const fileName = /\.txt$/i.test(title) ? title : `${title}.txt`;
      fileToUpload = new File([content], fileName, { type: 'text/plain' });
    }
    if (!fileToUpload) return;
    setUploading(true);
    setActionError('');
    try {
      const doc = await uploadDocument(fileToUpload, uploadSubjectId || null, uploadType);
      setDocs(prev => [doc, ...prev]);
      setUploadOpen(false);
      void extractDocumentText(doc).then(() => {
        void listDocuments().then(setDocs).catch(() => {});
      });
    } catch (err) {
      setActionError(err instanceof DocumentError ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function handleOpen(doc: SomaDocument) {
    setOpeningId(doc.id);
    try {
      const url = await getDocumentUrl(doc);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setActionError("Couldn't open that file. Try again.");
    } finally {
      setOpeningId(null);
    }
  }

  async function handleDelete(doc: SomaDocument) {
    setDocs(prev => prev.filter(d => d.id !== doc.id));
    try {
      await deleteDocument(doc);
    } catch {
      setDocs(prev => [doc, ...prev]);
      setActionError("Couldn't delete that file. Try again.");
    }
  }

  async function handleRetag(doc: SomaDocument, changes: { subjectId?: string | null; docType?: DocumentType }) {
    const optimistic = { ...doc, ...(changes.subjectId !== undefined ? { subjectId: changes.subjectId } : {}), ...(changes.docType !== undefined ? { docType: changes.docType } : {}) };
    setDocs(prev => prev.map(d => d.id === doc.id ? optimistic : d));
    try {
      const updated = await updateDocument(doc, changes);
      setDocs(prev => prev.map(d => d.id === doc.id ? updated : d));
    } catch {
      setDocs(prev => prev.map(d => d.id === doc.id ? doc : d));
      setActionError("Couldn't update that file. Try again.");
    }
  }

  if (state === 'loading') {
    return <div className={styles.container}><div className={styles.loading}>Loading documents…</div></div>;
  }

  if (state === 'not_set_up') {
    return (
      <div className={styles.container}>
        <div className={styles.setupNotice}>
          <h2 className={styles.setupTitle}>Documents isn't set up yet</h2>
          <p className={styles.setupBody}>
            Run <code>documents_migration.sql</code> (and <code>documents_doctype_migration.sql</code> if upgrading)
            in your Supabase SQL editor, then reload this page.
          </p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={styles.container}>
        <div className={styles.setupNotice}>
          <h2 className={styles.setupTitle}>Couldn't load documents</h2>
          <button type="button" className={styles.retryBtn} onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  function subjectBadge(doc: SomaDocument) {
    const subject = doc.subjectId ? subjectById.get(doc.subjectId) : undefined;
    return (
      <select
        className={styles.tagSelect}
        value={doc.subjectId ?? ''}
        onChange={e => handleRetag(doc, { subjectId: e.target.value || null })}
        style={subject ? { color: subject.color } : undefined}
        onClick={e => e.stopPropagation()}
      >
        <option value="">Unassigned</option>
        {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    );
  }

  function typeBadge(doc: SomaDocument) {
    return (
      <select
        className={styles.tagSelect}
        value={doc.docType}
        onChange={e => handleRetag(doc, { docType: e.target.value as DocumentType })}
        onClick={e => e.stopPropagation()}
      >
        {DOCUMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
    );
  }

  function extractionHint(doc: SomaDocument): string | null {
    switch (doc.extractionStatus) {
      case 'pending':
      case 'processing': return 'Soma is reading this file…';
      case 'failed':      return "Soma couldn't read this file";
      case 'unsupported': return "Soma can't read this file type yet — it's still viewable, just not searchable in chat";
      default: break;
    }
    if (doc.needsRag) {
      switch (doc.chunkStatus) {
        case 'pending':
        case 'processing': return "This file is large — Soma is indexing it for search…";
        case 'failed':      return "Soma read this file but couldn't index it for search — ask about it directly and it may still work";
        case 'done':        return 'Indexed for search — Soma pulls in relevant excerpts as needed';
        default:            return null;
      }
    }
    return null;
  }

  function extractionHintIsWarning(doc: SomaDocument): boolean {
    return doc.extractionStatus === 'failed' || doc.chunkStatus === 'failed';
  }

  function renderListRow(doc: SomaDocument) {
    const hint = extractionHint(doc);
    return (
      <div key={doc.id} className={styles.fileRow}>
        <span className={styles.fileExt}>{extLabel(doc.fileName, doc.fileType)}</span>
        <button
          type="button"
          className={styles.fileName}
          onClick={() => handleOpen(doc)}
          disabled={openingId === doc.id}
          title="Open"
        >
          {doc.fileName}
        </button>
        {hint && <span className={styles.fileExtractionHint} title={hint}>{extractionHintIsWarning(doc) ? '⚠' : '·'}</span>}
        {subjectBadge(doc)}
        {typeBadge(doc)}
        <span className={styles.fileMeta}>{formatSize(doc.sizeBytes)} · {formatDate(doc.createdAt)}</span>
        <button type="button" className={styles.fileDelete} onClick={() => handleDelete(doc)} title="Delete">×</button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Documents</h1>
        <p className={styles.subtitle}>Syllabi, readings, and guides — Soma's AI reads these when you ask about a subject.</p>
      </div>

      <div className={styles.toolbar}>
        <input
          className={styles.searchInput}
          type="search"
          placeholder="Search documents…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className={styles.filterSelect} value={typeFilter} onChange={e => setTypeFilter(e.target.value as DocumentType | 'all')}>
          <option value="all">All types</option>
          {DOCUMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select className={styles.filterSelect} value={subjectFilter} onChange={e => setSubjectFilter(e.target.value)}>
          <option value="all">All subjects</option>
          <option value="unassigned">Unassigned</option>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button type="button" className={styles.uploadBtn} onClick={openUploadModal}>+ Upload</button>
      </div>

      {actionError && <div className={styles.uploadError}>{actionError}</div>}

      {docs.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIllo}>📄</div>
          <h3 className={styles.emptyHeading}>No documents yet</h3>
          <p className={styles.emptyBody}>Upload a syllabus, reading, or guide to get started.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyBody}>No documents match your search or filters.</p>
        </div>
      ) : (
        <div className={styles.list}>{filtered.map(renderListRow)}</div>
      )}

      {uploadOpen && (
        <div className={styles.modalOverlay} onClick={() => !uploading && setUploadOpen(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <span className={styles.modalTitle}>Upload document</span>

            <div className={styles.modalModeToggle}>
              <button
                type="button"
                className={`${styles.modalModeBtn}${uploadMode === 'file' ? ` ${styles.modalModeBtnActive}` : ''}`}
                onClick={() => setUploadMode('file')}
              >Upload file</button>
              <button
                type="button"
                className={`${styles.modalModeBtn}${uploadMode === 'paste' ? ` ${styles.modalModeBtnActive}` : ''}`}
                onClick={() => setUploadMode('paste')}
              >Paste text</button>
            </div>

            {uploadMode === 'file' ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT_ATTR}
                  className={styles.hiddenInput}
                  onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                />
                <button type="button" className={styles.chooseFileBtn} onClick={() => fileInputRef.current?.click()}>
                  {uploadFile ? uploadFile.name : 'Choose file…'}
                </button>
              </>
            ) : (
              <>
                <input
                  type="text"
                  className={styles.modalTextInput}
                  placeholder="Title (e.g. AP Chem Syllabus)"
                  value={pasteTitle}
                  onChange={e => setPasteTitle(e.target.value)}
                />
                <textarea
                  className={styles.modalPasteArea}
                  placeholder="Paste the syllabus text here…"
                  value={pasteContent}
                  onChange={e => setPasteContent(e.target.value)}
                  rows={10}
                  spellCheck={false}
                />
              </>
            )}

            <label className={styles.modalLabel}>
              Subject
              <select className={styles.modalSelect} value={uploadSubjectId} onChange={e => setUploadSubjectId(e.target.value)}>
                <option value="">Unassigned</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>

            <label className={styles.modalLabel}>
              Type
              <select className={styles.modalSelect} value={uploadType} onChange={e => setUploadType(e.target.value as DocumentType)}>
                {DOCUMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>

            {actionError && <span className={styles.modalError}>{actionError}</span>}

            <button
              type="button"
              className={styles.modalUploadBtn}
              onClick={handleUpload}
              disabled={uploading || (uploadMode === 'file' ? !uploadFile : !pasteTitle.trim() || !pasteContent.trim())}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            <button type="button" className={styles.modalCancelBtn} onClick={() => setUploadOpen(false)} disabled={uploading}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
