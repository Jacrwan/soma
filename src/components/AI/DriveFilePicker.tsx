import { useState, useEffect, useRef } from 'react';
import { listDriveFiles, fileTypeLabel, DriveFile } from '../../lib/googleDrive';
import styles from './DriveFilePicker.module.css';

interface Props {
  googleToken: string;
  onPick: (file: DriveFile) => void;
  onClose: () => void;
}

function fmtModified(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const TYPE_ICON: Record<string, string> = {
  'application/vnd.google-apps.document': '📄',
  'application/vnd.google-apps.presentation': '📊',
  'application/vnd.google-apps.spreadsheet': '📈',
};

export default function DriveFilePicker({ googleToken, onPick, onClose }: Props) {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function load(query?: string) {
    setLoading(true);
    setError('');
    listDriveFiles(googleToken, query)
      .then(setFiles)
      .catch((e: Error) => {
        setError(
          e.message === 'google_token_expired'
            ? 'Google access expired — reconnect Google Drive in Settings.'
            : 'Could not load your Drive files. Try again.',
        );
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    searchRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function onSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(value.trim() || undefined), 350);
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Attach from Google Drive</span>
          <button className={styles.closeBtn} onClick={onClose} title="Close">✕</button>
        </div>

        <input
          ref={searchRef}
          className={styles.searchInput}
          placeholder="Search your Drive…"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
        />

        <div className={styles.fileList}>
          {loading && <div className={styles.stateMsg}>Loading…</div>}
          {!loading && error && <div className={styles.errorMsg}>{error}</div>}
          {!loading && !error && files.length === 0 && (
            <div className={styles.stateMsg}>
              {search ? 'No matching files.' : 'No readable files found in your Drive.'}
            </div>
          )}
          {!loading && !error && files.map(f => (
            <button key={f.id} className={styles.fileRow} onClick={() => onPick(f)}>
              <span className={styles.fileIcon}>{TYPE_ICON[f.mimeType] ?? '📁'}</span>
              <span className={styles.fileInfo}>
                <span className={styles.fileName}>{f.name}</span>
                <span className={styles.fileMeta}>
                  {fileTypeLabel(f.mimeType)} · {fmtModified(f.modifiedTime)}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className={styles.footerHint}>
          Only file types Soma can read are shown. For PDFs or Word/PowerPoint files,
          open them in Google Docs/Slides first, then attach.
        </div>
      </div>
    </div>
  );
}
