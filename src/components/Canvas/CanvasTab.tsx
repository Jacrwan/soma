import { useState, useEffect } from 'react';
import { storage } from '../../lib/storage';
import { CanvasCourse, CanvasAssignment, CanvasAnnouncement, Subject, Todo } from '../../types';
import { getCourses, getAssignments, getAnnouncements, getModules, getGrades } from '../../lib/canvas';
import { CanvasGrade } from '../../types';
import AssignmentDetail from './AssignmentDetail';
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

function looksLikeCanvasCourseName(name: string): boolean {
  return /\b(AP|Hon|Honors|Semester|Periods?|P\d|S[12]|Yr)\b/i.test(name)
    || /\bPer\s*:/i.test(name)
    || /-.+/.test(name)
    || /\(.+\bPeriods?\b.+\)/i.test(name);
}

function syncCoursesToSubjects(courses: CanvasCourse[]) {
  let subjects = storage.getSubjects();
  let changed = false;

  const currentCourseNames = new Set(courses.map(c => c.name));
  const knownCanvasCourseNames = new Set([
    ...storage.getCanvasCourseNames(),
    ...storage.getCachedCourses().map(c => c.name),
  ]);

  const prunedSubjects = subjects.filter(s =>
    currentCourseNames.has(s.name)
      || (!knownCanvasCourseNames.has(s.name) && !looksLikeCanvasCourseName(s.name))
  );
  if (prunedSubjects.length !== subjects.length) {
    subjects = prunedSubjects;
    changed = true;
  }

  // Add subjects for current courses that don't exist yet
  for (const course of courses) {
    const matchIdx = subjects.findIndex(s => s.name === course.name);
    if (matchIdx === -1) {
      subjects = [...subjects, {
        id: crypto.randomUUID(),
        name: course.name,
        color: COURSE_COLORS[subjects.length % COURSE_COLORS.length] as Subject['color'],
        totalTimeToday: 0,
      }];
      changed = true;
    }
  }

  storage.setCanvasCourseNames([...currentCourseNames]);
  if (changed) storage.setSubjects(subjects);
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
  const [clearedAssignments, setClearedAssignments] = useState<Record<number, boolean>>(
    () => storage.getClearedAssignments(),
  );
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [announcementsOpen, setAnnouncementsOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [lastSynced, setLastSynced] = useState<number | null>(() => storage.getCacheTimestamp());
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailAssignment, setDetailAssignment] = useState<CanvasAssignment | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'not_started' | 'in_progress' | 'done' | 'cleared'>('all');
  const [sortBy, setSortBy] = useState<'due' | 'course'>('due');
  const [canvasView, setCanvasView] = useState<'assignments' | 'grades'>('assignments');
  const [grades, setGrades] = useState<CanvasGrade[]>([]);
  const [gradesLoading, setGradesLoading] = useState(false);

  const isConnected = !!token && !!baseUrl;

  useEffect(() => {
    if (!isConnected) return;
    loadData(token, baseUrl);
  }, []);

  async function refreshSecondaryData(tk: string, url: string, coursesData: CanvasCourse[]) {
    const [announcementGroups, moduleGroups] = await Promise.all([
      Promise.all(coursesData.map(c => getAnnouncements(tk, url, c.id).catch(() => []))),
      Promise.all(coursesData.map(c => getModules(tk, url, c.id).catch(() => []))),
    ]);
    const flatAnnouncements = announcementGroups.flat();
    storage.setCachedAnnouncements(flatAnnouncements);
    setAnnouncements(flatAnnouncements);
    storage.setCachedModules(moduleGroups.flat());
  }

  async function loadData(tk: string, url: string, force = false) {
    const hasCachedAssignments = storage.getCachedAssignments().length > 0;
    if (force || hasCachedAssignments) setSyncing(true); else setLoading(true);
    setError('');
    try {
      const coursesData = await getCourses(tk, url);
      setCourses(coursesData);
      syncCoursesToSubjects(coursesData);
      storage.setCachedCourses(coursesData);
      const assignmentGroups = await Promise.all(
        coursesData.map(c => getAssignments(tk, url, c).catch(() => [])),
      );
      const all = assignmentGroups.flat();
      all.sort((a, b) => new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime());

      // Auto-mark submitted assignments as done
      const currentStatus = storage.getAssignmentStatus();
      const updatedStatus = { ...currentStatus };
      let statusChanged = false;
      for (const a of all) {
        if (a.score != null && a.score > 0 && updatedStatus[a.id] !== 'done') {
          updatedStatus[a.id] = 'done';
          statusChanged = true;
        } else if (a.score === 0 && !a.submittedAt && updatedStatus[a.id] !== 'not_started') {
          updatedStatus[a.id] = 'not_started';
          statusChanged = true;
        } else if (a.submittedAt && a.score == null && updatedStatus[a.id] !== 'done') {
          updatedStatus[a.id] = 'done';
          statusChanged = true;
        }
      }
      if (statusChanged) {
        storage.setAssignmentStatus(updatedStatus);
        setAssignmentStatus(updatedStatus);
      }

      setAssignments(all);
      storage.setCachedAssignments(all);
      const now = Date.now();
      storage.setCacheTimestamp(now);
      setLastSynced(now);
      setSyncing(false);
      setLoading(false);
      refreshSecondaryData(tk, url, coursesData).catch(() => {});
    } catch {
      setError('Failed to load. Check your token and URL.');
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  }

  async function loadGrades() {
    setGradesLoading(true);
    try {
      const data = await getGrades(token, baseUrl);
      setGrades(data);
    } catch {
      // silently fail — grades are best-effort
    } finally {
      setGradesLoading(false);
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
    const updated = { ...assignmentStatus, [String(id)]: status };
    storage.setAssignmentStatus(updated);
    setAssignmentStatus(updated);

    if (status === 'done') {
      setAssignmentCleared(id, true);
    }

    const todoStatusMap: Record<string, Todo['status']> = {
      not_started: 'nothing',
      in_progress: 'in_progress',
      done: 'done',
    };
    const newTodoStatus = todoStatusMap[status];
    if (newTodoStatus) {
      const todos = storage.getTodos();
      const updatedTodos = todos.map(t =>
        t.assignmentId === id ? { ...t, status: newTodoStatus } : t,
      );
      if (updatedTodos.some((t, i) => t.status !== todos[i].status)) {
        storage.setTodos(updatedTodos);
      }
    }
  }

  function setAssignmentCleared(id: number, cleared: boolean) {
    const updated = { ...clearedAssignments };
    if (cleared) {
      updated[id] = true;
    } else {
      delete updated[id];
    }
    storage.setClearedAssignments(updated);
    setClearedAssignments(updated);
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

  const filtered = assignments
    .filter(a => selectedCourseId === null || a.courseId === selectedCourseId)
    .filter(a => statusFilter === 'cleared' ? clearedAssignments[a.id] : !clearedAssignments[a.id])
    .filter(a => statusFilter === 'all' || statusFilter === 'cleared' || (assignmentStatus[a.id] ?? 'not_started') === statusFilter)
    .sort((a, b) => sortBy === 'due'
      ? new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime()
      : a.courseName.localeCompare(b.courseName)
    );

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
        <div className={styles.subNav}>
          <button
            className={`${styles.subNavBtn}${canvasView === 'assignments' ? ` ${styles.subNavBtnActive}` : ''}`}
            onClick={() => setCanvasView('assignments')}
          >Assignments</button>
          <button
            className={`${styles.subNavBtn}${canvasView === 'grades' ? ` ${styles.subNavBtnActive}` : ''}`}
            onClick={() => { setCanvasView('grades'); if (!grades.length) loadGrades(); }}
          >Grades</button>
        </div>
        <div className={styles.syncRow}>
          {lastSynced && (
            <span className={styles.syncLabel}>Last synced: {fmtSynced(lastSynced)}</span>
          )}
          <button
            className={styles.refreshBtn}
            onClick={() => canvasView === 'grades' ? loadGrades() : loadData(token, baseUrl, true)}
            disabled={syncing || loading || gradesLoading}
            title="Refresh"
          >↻</button>
        </div>
        <button className={styles.disconnectLink} onClick={handleDisconnect}>Disconnect</button>
      </div>

      {canvasView === 'grades' && (
        <div className={styles.gradesView}>
          {gradesLoading && <div className={styles.loading}>Loading grades…</div>}
          {!gradesLoading && grades.length === 0 && (
            <div className={styles.empty}>No grade data available.</div>
          )}
          {!gradesLoading && grades.length > 0 && (() => {
            const scored = grades.filter(g => g.currentScore !== null);
            const avg = scored.length
              ? (scored.reduce((s, g) => s + g.currentScore!, 0) / scored.length).toFixed(1)
              : null;
            const GRADE_COLORS: Record<string, string> = {
              A: '#66bb6a', B: '#42a5f5', C: '#ffa726', D: '#ef5350', F: '#ef5350',
            };
            const scoreColor = (s: number | null) => {
              if (s === null) return 'var(--text-muted)';
              if (s >= 90) return '#66bb6a';
              if (s >= 80) return '#42a5f5';
              if (s >= 70) return '#ffa726';
              return '#ef5350';
            };
            return (
              <>
                {avg && (
                  <div className={styles.gradesSummary}>
                    <span className={styles.gradesSummaryLabel}>Current Average</span>
                    <span className={styles.gradesSummaryScore} style={{ color: scoreColor(Number(avg)) }}>{avg}%</span>
                  </div>
                )}
                <div className={styles.gradesList}>
                  {grades.map((g, i) => (
                    <div key={g.courseId} className={styles.gradesRow}>
                      <span className={styles.gradesDot} style={{ background: COURSE_COLORS[i % COURSE_COLORS.length] }} />
                      <div className={styles.gradesInfo}>
                        <span className={styles.gradesName}>{g.courseName}</span>
                        <span className={styles.gradesCode}>{g.courseCode}</span>
                      </div>
                      <div className={styles.gradesRight}>
                        {g.currentScore !== null ? (
                          <>
                            <span className={styles.gradesLetter} style={{ color: GRADE_COLORS[g.currentGrade?.[0] ?? ''] ?? 'var(--text-muted)' }}>
                              {g.currentGrade ?? '—'}
                            </span>
                            <span className={styles.gradesScore} style={{ color: scoreColor(g.currentScore) }}>
                              {g.currentScore.toFixed(1)}%
                            </span>
                          </>
                        ) : (
                          <span className={styles.gradesNoGrade}>No grade</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Per-course assignment scores */}
                {assignments.length > 0 && (
                  <div className={styles.assignmentScores}>
                    <div className={styles.scoresHeader}>Assignment Scores</div>
                    {assignments
                      .filter(a => a.score !== null && a.score !== undefined)
                      .map(a => (
                        <div key={a.id} className={styles.scoreRow}>
                          <span className={styles.scoreDot} style={{ background: COURSE_COLORS[courses.findIndex(c => c.id === a.courseId) % COURSE_COLORS.length] }} />
                          <div className={styles.scoreInfo}>
                            <span className={styles.scoreName}>{a.name}</span>
                            <span className={styles.scoreCourse}>{a.courseName}</span>
                          </div>
                          <span className={styles.scoreValue} style={{ color: scoreColor(a.pointsPossible ? (a.score! / a.pointsPossible) * 100 : null) }}>
                            {a.score}/{a.pointsPossible ?? '?'}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {canvasView === 'assignments' && <div className={styles.layout}>
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
              <div className={styles.filterBar}>
                <div className={styles.filterPills}>
                  {(['all', 'not_started', 'in_progress', 'done', 'cleared'] as const).map(f => (
                    <button
                      key={f}
                      className={`${styles.filterPill}${statusFilter === f ? ` ${styles.filterPillActive}` : ''}`}
                      onClick={() => setStatusFilter(f)}
                    >
                      {f === 'all' ? 'Active' : f === 'not_started' ? 'Not started' : f === 'in_progress' ? 'In progress' : f === 'done' ? 'Done' : `Cleared (${Object.keys(clearedAssignments).length})`}
                    </button>
                  ))}
                </div>
                <button
                  className={styles.sortBtn}
                  onClick={() => setSortBy(s => s === 'due' ? 'course' : 'due')}
                  title="Toggle sort"
                >
                  {sortBy === 'due' ? 'By due date' : 'By course'} ↕
                </button>
              </div>
              <div className={styles.assignmentList}>
                {filtered.length === 0 ? (
                  <div className={styles.empty}>
                    {statusFilter === 'cleared' ? 'No cleared assignments.' : 'No active assignments.'}
                  </div>
                ) : filtered.map(a => {
                  const status = getStatus(a.id);
                  const done = status === 'done';
                  const cleared = !!clearedAssignments[a.id];
                  const color = courseColorMap[a.courseId] ?? '#ccc';
                  return (
                    <div
                      key={a.id}
                      className={`${styles.assignmentRow}${done ? ` ${styles.done}` : ''}${cleared ? ` ${styles.cleared}` : ''}`}
                      onClick={() => setDetailAssignment(a)}
                      style={{ cursor: 'pointer' }}
                    >
                      <span
                        className={styles.dot}
                        style={{ background: color, opacity: done ? 0.3 : 1 }}
                      />
                      <div className={styles.assignmentInfo}>
                        <span className={styles.assignmentName}>{a.name}</span>
                        <span className={styles.assignmentCourse}>{a.courseName}</span>
                      </div>
                      <div className={styles.assignmentRight}>
                        {a.score != null && a.pointsPossible != null && (
                          <span className={styles.assignmentScore} style={{
                            color: a.pointsPossible > 0
                              ? (() => {
                                  const pct = (a.score / a.pointsPossible) * 100;
                                  if (pct >= 90) return '#66bb6a';
                                  if (pct >= 80) return '#42a5f5';
                                  if (pct >= 70) return '#ffa726';
                                  return '#ef5350';
                                })()
                              : 'var(--text-muted)'
                          }}>
                            {a.score}/{a.pointsPossible}
                          </span>
                        )}
                        <span className={styles.assignmentDue}>Due: {fmtDue(a.dueAt)}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
                          <button
                            className={`${styles.doneToggle}${done ? ` ${styles.doneToggleActive}` : ''}`}
                            onClick={() => updateStatus(a.id, done ? 'not_started' : 'done')}
                            title={done ? 'Mark not started' : 'Mark done'}
                          >✓</button>
                          <button
                            className={styles.clearBtn}
                            onClick={() => setAssignmentCleared(a.id, !cleared)}
                            title={cleared ? 'Restore to active list' : 'Clear from Canvas page'}
                          >
                            {cleared ? 'Restore' : 'Clear'}
                          </button>
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
      </div>}

      {detailAssignment && (
        <AssignmentDetail
          courseId={detailAssignment.courseId}
          assignmentId={detailAssignment.id}
          onClose={() => setDetailAssignment(null)}
        />
      )}
    </div>
  );
}
