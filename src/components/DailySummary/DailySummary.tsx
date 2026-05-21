import { useEffect, useMemo, useState } from 'react';
import { sendMessage } from '../../lib/ai';
import { storage } from '../../lib/storage';
import { CanvasAnnouncement, CanvasAssignment } from '../../types';
import styles from './DailySummary.module.css';

const DISMISSED_KEY = 'soma_daily_summary_dismissed';
const SUMMARY_CACHE_KEY = 'soma_daily_summary_ai_cache';
const SUMMARY_CACHE_MAX_AGE = 6 * 60 * 60 * 1000;
const MORNING_CUTOFF_HOUR = 10;
const MAX_PRIMARY_ITEMS = 4;
const MAX_ANNOUNCEMENTS = 3;
const MAX_OVERDUE_ITEMS = 3;

type SummaryState = 'idle' | 'loading' | 'ready' | 'unavailable';

interface SummaryItem {
  key: string;
  type: 'assignment' | 'announcement';
  title: string;
  courseName: string;
  meta: string;
  body: string;
  htmlUrl?: string;
  isOverdue?: boolean;
  dismissalKey: string;
}

interface CachedSummary {
  signature: string;
  summary: string;
  timestamp: number;
}

function loadDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveDismissed(ids: string[]) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
}

function loadCachedSummary(signature: string, allowExpired = false): string {
  try {
    const raw = localStorage.getItem(SUMMARY_CACHE_KEY);
    if (!raw) return '';
    const cached = JSON.parse(raw) as CachedSummary;
    if (cached.signature !== signature || !cached.summary) return '';
    if (!allowExpired && Date.now() - cached.timestamp > SUMMARY_CACHE_MAX_AGE) return '';
    return cached.summary;
  } catch {
    return '';
  }
}

function saveCachedSummary(signature: string, summary: string) {
  const cached: CachedSummary = { signature, summary, timestamp: Date.now() };
  localStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify(cached));
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function tomorrowMorningCutoff(now: Date) {
  const d = startOfDay(now);
  d.setDate(d.getDate() + 1);
  d.setHours(MORNING_CUTOFF_HOUR, 0, 0, 0);
  return d;
}

function isDueSoon(assignment: CanvasAssignment, now: Date) {
  const due = new Date(assignment.dueAt);
  return due >= now && due < tomorrowMorningCutoff(now);
}

function isOverdue(assignment: CanvasAssignment, now: Date) {
  return new Date(assignment.dueAt) < now;
}

function isCompleted(assignment: CanvasAssignment, status: Record<string, string>) {
  return assignment.status === 'done' || status[String(assignment.id)] === 'done';
}

function hasSubmittedAt(value: unknown) {
  return value !== null && value !== undefined && value !== '';
}

function shouldIncludeUnsubmittedAssignment(assignment: CanvasAssignment) {
  const raw = assignment as CanvasAssignment & Record<string, unknown>;
  const submission = raw.submission as Record<string, unknown> | null | undefined;
  const submittedAt = raw.submitted_at ?? raw.submittedAt;

  if (!submission) {
    return !hasSubmittedAt(submittedAt);
  }

  const workflowState = String(submission.workflow_state ?? '').toLowerCase();
  const submissionSubmittedAt = submission.submitted_at;
  return workflowState === 'unsubmitted' && !hasSubmittedAt(submissionSubmittedAt);
}

function isRecent(announcement: CanvasAnnouncement, now: Date) {
  const posted = new Date(announcement.postedAt);
  return Number.isFinite(posted.getTime()) && now.getTime() - posted.getTime() <= 24 * 60 * 60 * 1000;
}

function fmtDueTime(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtDueLabel(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'Due date unavailable';
  const day = d.toLocaleDateString('en-US', { weekday: 'short' });
  return `Due ${day} ${fmtDueTime(iso)}`;
}

function fmtPostedLabel(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'Posted recently';
  return `Posted ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function trimText(text: string, max = 120) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max).trimEnd()}...`;
}

function decodeEntities(text: string) {
  if (typeof document === 'undefined') return text;
  const el = document.createElement('textarea');
  el.innerHTML = text;
  return el.value;
}

function formatDetailText(text: string | undefined, fallback: string) {
  if (!text) return fallback;
  const formatted = decodeEntities(text)
    .replace(/\u00a0/g, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<\/\s*(p|div|section|article|h[1-6]|li|ul|ol|tr)\s*>/gi, '\n')
    .replace(/<\/\s*(td|th)\s*>/gi, '\t')
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return formatted || fallback;
}

function assignmentKey(id: number) {
  return `assignment:${id}`;
}

function announcementKey(id: number, courseId: number) {
  return `announcement:${courseId}:${id}`;
}

function buildPrompt(dueSoon: CanvasAssignment[], overdue: CanvasAssignment[], announcements: CanvasAnnouncement[], courseNames: Map<number, string>) {
  const lines = [
    'Write one concise student-facing daily digest in 2-4 short sentences.',
    'Combine assignments and announcements. Do not list every item. Do not include raw bodies.',
    'Mention urgency, course names, and what the student should notice first.',
    '',
    'Due soon:',
    ...dueSoon.slice(0, MAX_PRIMARY_ITEMS).map(a => `- ${a.courseName}: ${a.name} (${fmtDueLabel(a.dueAt)})`),
    '',
    'Overdue:',
    ...overdue.slice(0, MAX_OVERDUE_ITEMS).map(a => `- ${a.courseName}: ${a.name}`),
    '',
    'Recent announcements:',
    ...announcements.slice(0, MAX_ANNOUNCEMENTS).map(a => {
      const courseName = courseNames.get(a.courseId) ?? 'Course';
      return `- ${courseName}: ${a.title}${a.message ? ` - ${trimText(a.message, 90)}` : ''}`;
    }),
  ];
  return lines.join('\n');
}

function buildSummarySignature(dueSoon: CanvasAssignment[], overdue: CanvasAssignment[], announcements: CanvasAnnouncement[]) {
  return JSON.stringify({
    dueSoon: dueSoon.map(a => [a.id, a.courseId, a.name, a.courseName, a.dueAt, a.description ?? '', a.submission?.workflow_state ?? '', a.submission?.submitted_at ?? '']),
    overdue: overdue.map(a => [a.id, a.courseId, a.name, a.courseName, a.dueAt, a.description ?? '', a.submission?.workflow_state ?? '', a.submission?.submitted_at ?? '']),
    announcements: announcements.map(a => [a.id, a.courseId, a.title, a.postedAt, a.message ?? '']),
  });
}

function cleanAiSummary(text: string) {
  return trimText(text.replace(/<[^>]*>/g, '').trim(), 520);
}

export default function DailySummary() {
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed);
  const [summaryState, setSummaryState] = useState<SummaryState>('idle');
  const [aiSummary, setAiSummary] = useState('');
  const [selectedItem, setSelectedItem] = useState<SummaryItem | null>(null);
  const [showHiddenItems, setShowHiddenItems] = useState(false);

  const data = useMemo(() => {
    const now = new Date();
    const dismissedSet = new Set(dismissed);
    const status = storage.getAssignmentStatus() as Record<string, string>;
    const courseNames = new Map(storage.getCachedCourses().map(c => [c.id, c.name]));

    const visibleAssignments = storage.getCachedAssignments()
      .filter(a => !isCompleted(a, status) && shouldIncludeUnsubmittedAssignment(a))
      .filter(a => !dismissedSet.has(assignmentKey(a.id)));

    const dueSoon = visibleAssignments
      .filter(a => isDueSoon(a, now))
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

    const overdue = visibleAssignments
      .filter(a => isOverdue(a, now))
      .sort((a, b) => new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime());

    const announcements = storage.getCachedAnnouncements()
      .filter(a => !dismissedSet.has(announcementKey(a.id, a.courseId)))
      .filter(a => isRecent(a, now))
      .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());

    return { dueSoon, overdue, announcements, courseNames };
  }, [dismissed]);

  const itemGroups = useMemo(() => {
    const dueSoon = data.dueSoon.map(assignment => ({
      key: assignmentKey(assignment.id),
      type: 'assignment' as const,
      title: assignment.name,
      courseName: assignment.courseName,
      meta: fmtDueLabel(assignment.dueAt),
      body: formatDetailText(assignment.description, 'No assignment description is available.'),
      htmlUrl: assignment.htmlUrl,
      dismissalKey: assignmentKey(assignment.id),
    }));

    const announcements = data.announcements.map(announcement => ({
      key: announcementKey(announcement.id, announcement.courseId),
      type: 'announcement' as const,
      title: announcement.title,
      courseName: data.courseNames.get(announcement.courseId) ?? 'Course',
      meta: fmtPostedLabel(announcement.postedAt),
      body: formatDetailText(announcement.message, 'No announcement body is available.'),
      htmlUrl: announcement.htmlUrl,
      dismissalKey: announcementKey(announcement.id, announcement.courseId),
    }));

    const overdue = data.overdue.map(assignment => ({
      key: assignmentKey(assignment.id),
      type: 'assignment' as const,
      title: assignment.name,
      courseName: assignment.courseName,
      meta: fmtDueLabel(assignment.dueAt),
      body: formatDetailText(assignment.description, 'No assignment description is available.'),
      htmlUrl: assignment.htmlUrl,
      isOverdue: true,
      dismissalKey: assignmentKey(assignment.id),
    }));

    return { dueSoon, announcements, overdue };
  }, [data]);

  const items = useMemo<SummaryItem[]>(() => [
    ...itemGroups.dueSoon.slice(0, MAX_PRIMARY_ITEMS),
    ...itemGroups.announcements.slice(0, MAX_ANNOUNCEMENTS),
    ...itemGroups.overdue.slice(0, MAX_OVERDUE_ITEMS),
  ], [itemGroups]);

  const hiddenItems = useMemo<SummaryItem[]>(() => {
    const visibleKeys = new Set(items.map(item => item.key));
    return [
      ...itemGroups.dueSoon,
      ...itemGroups.announcements,
      ...itemGroups.overdue,
    ].filter(item => !visibleKeys.has(item.key));
  }, [itemGroups, items]);

  const summaryPrompt = useMemo(
    () => buildPrompt(data.dueSoon, data.overdue, data.announcements, data.courseNames),
    [data],
  );

  const summarySignature = useMemo(
    () => buildSummarySignature(data.dueSoon, data.overdue, data.announcements),
    [data],
  );

  useEffect(() => {
    if (data.dueSoon.length === 0 && data.overdue.length === 0 && data.announcements.length === 0) {
      setSummaryState('ready');
      setAiSummary('');
      return;
    }

    const cached = loadCachedSummary(summarySignature);
    if (cached) {
      setAiSummary(cached);
      setSummaryState('ready');
      return;
    }

    const staleCached = loadCachedSummary(summarySignature, true);
    let cancelled = false;
    setAiSummary(staleCached);
    setSummaryState(staleCached ? 'ready' : 'loading');

    sendMessage(
      [{ role: 'user', content: summaryPrompt }],
      'You write compact daily summaries for students. Keep output short, calm, and useful.',
    )
      .then(text => {
        if (cancelled) return;
        const summary = cleanAiSummary(text);
        if (summary) {
          saveCachedSummary(summarySignature, summary);
          setAiSummary(summary);
          setSummaryState('ready');
        } else {
          setAiSummary(staleCached);
          setSummaryState(staleCached ? 'ready' : 'unavailable');
        }
      })
      .catch(() => {
        if (cancelled) return;
        const fallback = loadCachedSummary(summarySignature, true);
        setAiSummary(fallback);
        setSummaryState(fallback ? 'ready' : 'unavailable');
      });

    return () => {
      cancelled = true;
    };
  }, [data, summaryPrompt, summarySignature]);

  function dismiss(id: string) {
    setDismissed(prev => {
      const next = prev.includes(id) ? prev : [...prev, id];
      saveDismissed(next);
      return next;
    });
  }

  function itemClassName(item: SummaryItem, baseClass: string) {
    const categoryClass = item.isOverdue
      ? styles.overdueItem
      : item.type === 'announcement'
        ? styles.announcementItem
        : styles.dueItem;
    return `${baseClass} ${categoryClass}`;
  }

  if (data.dueSoon.length === 0 && data.announcements.length === 0 && data.overdue.length === 0) {
    return (
      <section className={styles.summary} aria-label="Daily summary">
        <div className={styles.header}>
          <span className={styles.title}>Daily summary</span>
          <span className={styles.meta}>Nothing urgent from Canvas</span>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className={styles.summary} aria-label="Daily summary">
        <div className={styles.header}>
          <span className={styles.title}>Daily summary</span>
          <span className={styles.meta}>1-minute digest</span>
        </div>

        <div className={styles.digest}>
          {summaryState === 'loading' && <span className={styles.loading}>Writing summary...</span>}
          {summaryState === 'ready' && aiSummary && <p className={styles.summaryText}>{aiSummary}</p>}
          {summaryState === 'unavailable' && (
            <div className={styles.unavailable}>AI summary unavailable. Showing condensed items only.</div>
          )}
        </div>

        <div className={styles.itemList}>
          {items.map(item => (
            <div
              key={item.key}
              role="button"
              tabIndex={0}
              className={itemClassName(item, styles.item)}
              onClick={() => setSelectedItem(item)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedItem(item);
                }
              }}
            >
              <span className={styles.itemType}>{item.isOverdue ? 'Overdue' : item.type === 'assignment' ? 'Due' : 'News'}</span>
              <span className={styles.itemBody}>
                <span className={styles.course}>{item.courseName}</span>
                <span className={styles.itemTitle}>{item.title}</span>
                <span className={styles.metaLine}>{item.meta}</span>
              </span>
              <span
                role="button"
                tabIndex={0}
                className={styles.dismiss}
                onClick={e => {
                  e.stopPropagation();
                  dismiss(item.dismissalKey);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    dismiss(item.dismissalKey);
                  }
                }}
                aria-label={`Dismiss ${item.title}`}
              >
                {item.isOverdue ? 'Dismiss' : 'Hide'}
              </span>
            </div>
          ))}
          {hiddenItems.length > 0 && (
            <button className={styles.viewMore} onClick={() => setShowHiddenItems(true)}>
              View more ({hiddenItems.length})
            </button>
          )}
        </div>
      </section>

      {showHiddenItems && (
        <div className={styles.modalOverlay} onClick={() => setShowHiddenItems(false)}>
          <div
            className={`${styles.modal} ${styles.allItemsModal}`}
            role="dialog"
            aria-modal="true"
            aria-label="More daily summary items"
            onClick={e => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalCourse}>Daily summary</div>
                <div className={styles.modalTitle}>More items</div>
                <div className={styles.modalMeta}>Items condensed out of the main digest</div>
              </div>
              <button className={styles.closeBtn} onClick={() => setShowHiddenItems(false)}>Close</button>
            </div>
            <div className={styles.hiddenList}>
              {hiddenItems.map(item => (
                <div
                  key={item.key}
                  role="button"
                  tabIndex={0}
                  className={itemClassName(item, styles.hiddenItem)}
                  onClick={() => {
                    setShowHiddenItems(false);
                    setSelectedItem(item);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setShowHiddenItems(false);
                      setSelectedItem(item);
                    }
                  }}
                >
                  <span className={styles.itemType}>{item.isOverdue ? 'Overdue' : item.type === 'assignment' ? 'Due' : 'News'}</span>
                  <span className={styles.itemBody}>
                    <span className={styles.course}>{item.courseName}</span>
                    <span className={styles.itemTitle}>{item.title}</span>
                    <span className={styles.metaLine}>{item.meta}</span>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    className={styles.dismiss}
                    onClick={e => {
                      e.stopPropagation();
                      dismiss(item.dismissalKey);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        dismiss(item.dismissalKey);
                      }
                    }}
                    aria-label={`Dismiss ${item.title}`}
                  >
                    {item.isOverdue ? 'Dismiss' : 'Hide'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedItem && (
        <div className={styles.modalOverlay} onClick={() => setSelectedItem(null)}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label={selectedItem.title}
            onClick={e => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalCourse}>{selectedItem.courseName}</div>
                <div className={styles.modalTitle}>{selectedItem.title}</div>
                <div className={styles.modalMeta}>{selectedItem.meta}</div>
              </div>
              <button className={styles.closeBtn} onClick={() => setSelectedItem(null)}>Close</button>
            </div>
            <div className={styles.modalBody}>{selectedItem.body}</div>
            {selectedItem.htmlUrl && (
              <a className={styles.openLink} href={selectedItem.htmlUrl} target="_blank" rel="noreferrer">
                Open in Canvas
              </a>
            )}
          </div>
        </div>
      )}
    </>
  );
}
