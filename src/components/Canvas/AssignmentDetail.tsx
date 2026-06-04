import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import styles from './AssignmentDetail.module.css';

interface AssignmentAttachment {
  id: number;
  filename: string;
  contentType: string;
  url: string;
  size: number;
}

interface AssignmentDetails {
  id: number;
  name: string;
  description: string | null;
  dueAt: string | null;
  htmlUrl: string;
  attachments: AssignmentAttachment[];
}

interface Props {
  courseId: number;
  assignmentId: number;
  onClose: () => void;
}

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'a', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'img',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class', 'style'],
    ALLOW_DATA_ATTR: false,
    FORCE_BODY: true,
  });
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AssignmentDetail({ courseId, assignmentId, onClose }: Props) {
  const [details] = useState<AssignmentDetails | null>(null);
  const [loading] = useState(false);
  const [error, setError] = useState('');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const pdfs = details?.attachments.filter(a =>
    a.contentType === 'application/pdf' || a.filename.endsWith('.pdf')
  ) ?? [];
  const otherFiles = details?.attachments.filter(a =>
    a.contentType !== 'application/pdf' && !a.filename.endsWith('.pdf')
  ) ?? [];

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {loading && <div className={styles.loading}>Loading…</div>}
        {error && <div className={styles.error}>{error}</div>}

        {details && !loading && (
          <div className={styles.content}>
            <h2 className={styles.title}>{details.name}</h2>
            {details.dueAt && (
              <span className={styles.due}>
                Due {new Date(details.dueAt).toLocaleDateString('en-US', {
                  weekday: 'short', month: 'short', day: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                })}
              </span>
            )}

            <a
              className={styles.openLink}
              href={details.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Canvas ↗
            </a>

            {details.description && (
              <div className={styles.section}>
                <span className={styles.sectionLabel}>Description</span>
                <div
                  className={styles.description}
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(details.description) }}
                />
              </div>
            )}

            {pdfs.length > 0 && (
              <div className={styles.section}>
                <span className={styles.sectionLabel}>Attached PDFs</span>
                <div className={styles.fileList}>
                  {pdfs.map(f => (
                    <button
                      key={f.id}
                      className={`${styles.fileChip} ${pdfUrl === f.url ? styles.fileChipActive : ''}`}
                      onClick={() => setPdfUrl(pdfUrl === f.url ? null : f.url)}
                    >
                      <span className={styles.fileIcon}>PDF</span>
                      <span className={styles.fileName}>{f.filename}</span>
                      <span className={styles.fileSize}>{fmtSize(f.size)}</span>
                    </button>
                  ))}
                </div>
                {pdfUrl && (
                  <iframe
                    key={pdfUrl}
                    src={pdfUrl}
                    className={styles.pdfViewer}
                    title="PDF viewer"
                    sandbox="allow-scripts allow-same-origin"
                  />
                )}
              </div>
            )}

            {otherFiles.length > 0 && (
              <div className={styles.section}>
                <span className={styles.sectionLabel}>Attachments</span>
                <div className={styles.fileList}>
                  {otherFiles.map(f => (
                    <a
                      key={f.id}
                      className={styles.fileChip}
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className={styles.fileIcon}>↓</span>
                      <span className={styles.fileName}>{f.filename}</span>
                      <span className={styles.fileSize}>{fmtSize(f.size)}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
