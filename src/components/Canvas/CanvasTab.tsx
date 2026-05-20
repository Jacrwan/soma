import { useState, useEffect } from 'react';
import { storage } from '../../lib/storage';
import { CanvasCourse, CanvasAssignment, CanvasAnnouncement, Subject } from '../../types';
import { getCourses, getAssignments, getAnnouncements, getModules } from '../../lib/canvas';
import styles from './CanvasTab.module.css';

const COURSE_COLORS = [
  '#ef5350', '#42a5f5', '#66bb6a', '#ab47bc',
  '#ffa726', '#26c6da', '#ec407a', '#8d6e63',
];

function fmtDue(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function fmtPosted(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const CACHE_MAX_AGE = 30 * 60 * 1000;

function syncCoursesToSubjects(courses: CanvasCourse[]) {
  const existing = storage.getSubjects();
  const existingNames = new Set(existing.map(s => s.name.toLowerCase()));
  const newSubjects = courses
    .filter(c => !existingNames.has(c.name.toLowerCase()))
    .map((c, i) => ({
      id: crypto.randomUUID(),
      name: c.name,
      color: COURSE_COLORS[(existing.length + i) % COURSE_COLORS.length] as Subject['color'],
      totalTimeToday: 0,
    }));
  if (newSubjects.length > 0) {
    storage.setSubjects([...existing, ...newSubjects]);
  }
}

function fmtSynced(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  return `${mins} mins ago`;
}

export default function CanvasTab() {
  const [token, setToken] = useState(() => storage.getCanvasToken());
  const [baseUrl, setBaseUrl] = useState(() => storage.getCanvasBaseUrl());
  const [setupUrl, setSetupUrl] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState('');

  const [courses, setCourses] = useState<CanvasCourse[]>(() => storage.getCachedCourses());
  const [assignments, setAssignments] = useState<CanvasAssignment[]>(() => storage.getCachedAssignments());
  const [announcements, setAnnouncements] = useState<CanvasAnnouncement[]>(
    () => storage.getCachedAnnouncements(),
  );
  const [assignmentStatus, setAssignmentStatus] = useState<Record<number, string>>(
    () => storage.getAssignmentStatus(),
  );
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [announcementsOpen, setAnnouncementsOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [lastSynced, setLastSynced] = useState<number | null>(() => storage.getCacheTimestamp());
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isConnected = !!token && !!baseUrl;

  useEffect(() => {
    if (!isConnected) return;
    const ts = storage.getCacheTimestamp();
    if (ts && Date.now() - ts < CACHE_MAX_AGE) {
      const cachedCourses = storage.getCachedCourses();
      setCourses(cachedCourses);
      syncCoursesToSubjects(cachedCourses);
      setAssignments(storage.getCachedAssignments());
      setAnnouncements(storage.getCachedAnnouncements());
      setLastSynced(ts);
    } else {
      loadData(token, baseUrl);
    }
  }, []);

  async function loadData(tk: string, url: string, force = false) {
    if (force) setSyncing(true); else setLoading(true);
    setError('');
    try {
      const coursesData = await getCourses(tk, url);
      setCourses(coursesData);
      storage.setCachedCourses(coursesData);
      syncCoursesToSubjects(coursesData);
      const [assignmentGroups, announcementGroups, moduleGroups] = await Promise.all([
        Promise.all(coursesData.map(c => getAssignments(tk, url, c))),
        Promise.all(coursesData.map(c => getAnnouncements(tk, url, c.id))),
        Promise.all(coursesData.map(c => getModules(tk, url, c.id))),
      ]);
      const all = assignmentGroups.flat();
      all.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
      setAssignments(all);
      storage.setCachedAssignments(all);
      const flatAnnouncements = announcementGroups.flat();
      storage.setCachedAnnouncements(flatAnnouncements);
      setAnnouncements(flatAnnouncements);
      storage.setCachedModules(moduleGroups.flat());
      const now = Date.now();
      storage.setCacheTimestamp(now);
      setLastSynced(now);
    } catch {
      setError('Failed to load. Check your token and URL.');
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  }

  async function handleConnect() {
    const url = setupUrl.trim().replace(/\/$/, '');
    const tk = setupToken.trim();
    if (!url || !tk) return;
    setConnectLoading(true);
    setConnectError('');
    try {
      const validationBase = import.meta.env.DEV ? '/canvas-api' : url;
      const res = await fetch(`${validationBase}/api/v1/courses?per_page=1`, {
        headers: { Authorization: `Bearer ${tk}` },
      });
      if (!res.ok) throw new Error('bad');
      storage.setCanvasToken(tk);
      storage.setCanvasBaseUrl(url);
      setToken(tk);
      setBaseUrl(url);
      loadData(tk, url);
    } catch {
      setConnectError('Invalid token or URL.');
    } finally {
      setConnectLoading(false);
    }
  }

  function handleDisconnect() {
    storage.setCanvasToken('');
    storage.setCanvasBaseUrl('');
    setToken('');
    setBaseUrl('');
    setCourses([]);
    setAssignments([]);
    setSelectedCourseId(null);
    setSetupUrl('');
    setSetupToken('');
  }

  function updateStatus(id: number, status: string) {
    const updated = { ...assignmentStatus, [id]: status };
    storage.setAssignmentStatus(updated);
    setAssignmentStatus(updated);
  }

  function getStatus(id: number) {
    return assignmentStatus[id] ?? 'not_started';
  }

  // ── Setup card ──────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className={styles.setupOverlay}>
        <div className={styles.setupCard}>
          <span className={styles.setupTitle}>Connect Canvas</span>
          <div className={styles.setupField}>
            <label className={styles.setupLabel}>Canvas URL</label>
            <input
              className={styles.setupInput}
              placeholder="https://canvas.instructure.com"
              value={setupUrl}
              onChange={e => setSetupUrl(e.target.value)}
            />
          </div>
          <div className={styles.setupField}>
            <label className={styles.setupLabel}>API Token</label>
            <input
              className={styles.setupInput}
              type="password"
              placeholder="Paste your token"
              value={setupToken}
              onChange={e => setSetupToken(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleConnect(); }}
            />
          </div>
          {connectError && <span className={styles.setupError}>{connectError}</span>}
          <button
            className={styles.setupBtn}
            onClick={handleConnect}
            disabled={connectLoading || !setupUrl.trim() || !setupToken.trim()}
          >
            {connectLoading ? 'Connecting…' : 'Connect'}
          </button>
          <div className={styles.setupHint}>
            <strong>How to get your token:</strong><br />
            Canvas → Account → Settings →<br />
            Approved Integrations → New Access Token
          </div>
        </div>
      </div>
    );
  }

  // ── Main view ────────────────────────────────────────────────────────────
  const courseColorMap = Object.fromEntries(
    courses.map((c, i) => [c.id, COURSE_COLORS[i % COURSE_COLORS.length]]),
  );

  const filtered = selectedCourseId === null
    ? assignments
    : assignments.filter(a => a.courseId === selectedCourseId);

  const filteredAnnouncements = selectedCourseId === null
    ? announcements
    : announcements.filter(a => a.courseId === selectedCourseId);

  function toggleExpanded(id: number) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <div className={styles.syncRow}>
          {lastSynced && (
            <span className={styles.syncLabel}>Last synced: {fmtSynced(lastSynced)}</span>
          )}
          <button
            className={styles.refreshBtn}
            onClick={() => loadData(token, baseUrl, true)}
            disabled={syncing || loading}
            title="Refresh"
          >{syncing ? '↻' : '↻'}</button>
        </div>
        <button className={styles.disconnectLink} onClick={handleDisconnect}>Disconnect</button>
      </div>

      <div className={styles.layout}>
        {/* ── Course sidebar ── */}
        <div className={styles.sidebar}>
          <button
            className={`${styles.pill}${selectedCourseId === null ? ` ${styles.pillActive}` : ''}`}
            onClick={() => setSelectedCourseId(null)}
          >All</button>
          {courses.map(c => (
            <button
              key={c.id}
              className={`${styles.pill}${selectedCourseId === c.id ? ` ${styles.pillActive}` : ''}`}
              onClick={() => setSelectedCourseId(c.id)}
            >{c.name}</button>
          ))}
        </div>

        {/* ── Assignment area ── */}
        <div className={styles.main}>
          {loading && <div className={styles.loading}>Loading…</div>}

          {!loading && error && (
            <div className={styles.errorState}>
              <span>{error}</span>
              <button className={styles.retryBtn} onClick={() => loadData(token, baseUrl)}>Retry</button>
            </div>
          )}

          {!loading && !error && (
            <>
              <div className={styles.assignmentList}>
                {filtered.length === 0 ? (
                  <div className={styles.empty}>No upcoming assignments.</div>
                ) : filtered.map(a => {
                  const status = getStatus(a.id);
                  const done = status === 'done';
                  const color = courseColorMap[a.courseId] ?? '#ccc';
                  return (
                    <div key={a.id} className={`${styles.assignmentRow}${done ? ` ${styles.done}` : ''}`}>
                      <span
                        className={styles.dot}
                        style={{ background: color, opacity: done ? 0.3 : 1 }}
                      />
                      <div className={styles.assignmentInfo}>
                        <span className={styles.assignmentName}>{a.name}</span>
                        <span className={styles.assignmentCourse}>{a.courseName}</span>
                      </div>
                      <div className={styles.assignmentRight}>
                        <span className={styles.assignmentDue}>Due: {fmtDue(a.dueAt)}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <select
                            className={styles.statusSelect}
                            value={status}
                            onChange={e => updateStatus(a.id, e.target.value)}
                          >
                            <option value="not_started">Not started</option>
                            <option value="in_progress">In progress</option>
                            <option value="done">Done</option>
                          </select>
                          <a
                            className={styles.externalLink}
                            href={a.htmlUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in Canvas"
                          >↗</a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={styles.announcementsSection}>
                <button
                  className={styles.sectionHeader}
                  onClick={() => setAnnouncementsOpen(o => !o)}
                >
                  <span className={styles.sectionTitle}>Announcements</span>
                  <span className={styles.sectionRule} />
                  <span className={styles.caret}>{announcementsOpen ? '▾' : '▸'}</span>
                </button>
                {announcementsOpen && (
                  <div className={styles.announcementList}>
                    {filteredAnnouncements.length === 0 ? (
                      <div className={styles.announcementsEmpty}>No announcements.</div>
                    ) : filteredAnnouncements.map(a => {
                      const expanded = expandedIds.has(a.id);
                      const courseName = courses.find(c => c.id === a.courseId)?.name ?? '';
                      return (
                        <div
                          key={a.id}
                          className={styles.announcementCard}
                          onClick={() => toggleExpanded(a.id)}
                        >
                          <div className={styles.announcementTop}>
                            <span className={styles.announcementCourse}>{courseName}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span className={styles.announcementDate}>
                                {a.postedAt ? fmtPosted(a.postedAt) : ''}
                              </span>
                              {a.htmlUrl && (
                                <a
                                  className={styles.externalLink}
                                  href={a.htmlUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Open in Canvas"
                                  onClick={e => e.stopPropagation()}
                                >↗</a>
                              )}
                            </div>
                          </div>
                          <span className={styles.announcementTitle}>{a.title}</span>
                          <span className={expanded ? styles.announcementBodyExpanded : styles.announcementBody}>
                            {a.message}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className={styles.studyPlan}>
                <div className={styles.studyPlanHeader}>
                  <span className={styles.studyPlanTitle}>Study Plan</span>
                  <div className={styles.studyPlanRule} />
                </div>
                <div className={styles.studyPlanBody}>
                  <button className={styles.generateBtn} disabled>Generate Study Plan</button>
                  <span className={styles.comingSoon}>Coming in Phase 4</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
