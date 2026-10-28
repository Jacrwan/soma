import { useEffect, useState } from 'react';
import { storage } from '../../lib/storage';
import { CANVAS_CHANGED, EXTENSION_STORE_URL, deepSyncStatus, extensionPresent } from '../../lib/canvasExtension';
import { canvasSnapshots, getLocalSnapshots, subjectForCourse } from '../../lib/canvasDeepSync';
import CanvasGuide from './CanvasGuide';
import styles from './ExtensionSetup.module.css';

/**
 * Onboarding's Canvas step, driven by the Soma for Canvas extension itself.
 * Each part ticks off on its own: installed when the extension's bridge says
 * "present" on this page, synced when its first Canvas snapshot lands. The
 * student only ever does the next thing in front of them.
 *
 * Chrome adds an extension's scripts to pages opened after it is installed,
 * so this tab can't see a fresh install until it reloads. The parent keeps
 * the answers so far across that reload (see OnboardingFlow).
 */

type Stage = 'install' | 'canvas' | 'done';

function read() {
  const sites = deepSyncStatus();
  const installed = !!extensionPresent();
  const stage: Stage = sites.length ? 'done' : installed ? 'canvas' : 'install';
  return { installed, sites, stage };
}

/** "https://bcourses.berkeley.edu/courses" or "school.instructure.com" → the origin to open. */
function canvasOrigin(input: string): string | null {
  const raw = input.trim().replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(raw)) return null;
  return `https://${raw}`;
}

const dueLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

function Mark({ state, n }: { state: 'todo' | 'active' | 'done'; n: number }) {
  return (
    <span className={`${styles.mark} ${styles[state]}`} aria-hidden="true">
      {state === 'done' ? '✓' : n}
    </span>
  );
}

interface Props {
  /** Save what the student answered so far, before the page reloads. */
  onBeforeReload?: () => void;
}

export default function ExtensionSetup({ onBeforeReload }: Props) {
  const [live, setLive] = useState(read);
  const [openedStore, setOpenedStore] = useState(false);
  const [back, setBack] = useState(false);
  const [address, setAddress] = useState(() => localStorage.getItem('soma_ob_canvas') ?? '');
  const [openedCanvas, setOpenedCanvas] = useState(false);

  useEffect(() => {
    const refresh = () => setLive(read());
    window.addEventListener(CANVAS_CHANGED, refresh);
    return () => window.removeEventListener(CANVAS_CHANGED, refresh);
  }, []);

  // Coming back from the Web Store tab is the moment to offer the reload.
  useEffect(() => {
    if (!openedStore) return;
    const onReturn = () => { if (document.visibilityState === 'visible') setBack(true); };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => { document.removeEventListener('visibilitychange', onReturn); window.removeEventListener('focus', onReturn); };
  }, [openedStore]);

  const { stage, sites } = live;
  const origin = canvasOrigin(address);

  function openCanvas() {
    if (!origin) return;
    localStorage.setItem('soma_ob_canvas', address.trim());
    window.open(origin, '_blank', 'noopener,noreferrer');
    setOpenedCanvas(true);
  }

  function reload() {
    onBeforeReload?.();
    window.location.reload();
  }

  // What came in, once it has.
  const snapshot = canvasSnapshots(getLocalSnapshots())[0];
  const subjects = storage.getSubjects();
  const colorOf = (id: number, name: string) => subjectForCourse(subjects, id, name)?.color ?? 'var(--accent)';
  const courses = snapshot
    ? snapshot.courses.filter(c => snapshot.assignments.some(a => a.courseId === c.id))
    : [];
  const now = Date.now();
  const upcoming = stage === 'done'
    ? storage.getCachedAssignments()
        .filter(a => a.dueAt && Date.parse(a.dueAt) > now && a.status !== 'done' && !a.submittedAt)
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
        .slice(0, 3)
    : [];
  const totals = sites.reduce((t, s) => ({ courses: t.courses + s.courses, assignments: t.assignments + s.assignments }), { courses: 0, assignments: 0 });

  const state = (s: Stage): 'todo' | 'active' | 'done' => {
    const order: Stage[] = ['install', 'canvas', 'done'];
    const at = order.indexOf(stage), me = order.indexOf(s);
    return me < at ? 'done' : me === at ? 'active' : 'todo';
  };

  return (
    <div className={styles.wrap}>
    <CanvasGuide start={stage === 'install' ? 'install' : stage === 'canvas' ? 'canvas' : 'soma'} />
    <ol className={styles.list} aria-live="polite">
      {/* 1 — Add it */}
      <li className={`${styles.item} ${styles[state('install')]}`}>
        <Mark state={state('install')} n={1} />
        <div className={styles.body}>
          <span className={styles.title}>Add Soma for Canvas to Chrome</span>
          {stage === 'install' ? (
            <>
              <p className={styles.text}>Free on the Chrome Web Store. It also works in Edge, Brave and Arc.</p>
              <div className={styles.row}>
                <a
                  className={styles.primary}
                  href={EXTENSION_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpenedStore(true)}
                >
                  Add to Chrome
                </a>
                {(back || openedStore) && (
                  <button type="button" className={styles.secondary} onClick={reload}>
                    I added it, reload
                  </button>
                )}
              </div>
              {back && (
                <p className={styles.hint}>
                  Chrome only connects an extension to pages opened after it was added. Reloading keeps your answers.
                </p>
              )}
            </>
          ) : (
            <span className={styles.doneText}>Installed</span>
          )}
        </div>
      </li>

      {/* 2 — Open Canvas */}
      <li className={`${styles.item} ${styles[state('canvas')]}`}>
        <Mark state={state('canvas')} n={2} />
        <div className={styles.body}>
          <span className={styles.title}>Open Canvas and sign in</span>
          {stage === 'canvas' && (
            <>
              <p className={styles.text}>
                The extension reads Canvas from the page you are signed in to. It never sees your password.
              </p>
              <form className={styles.row} onSubmit={e => { e.preventDefault(); openCanvas(); }}>
                <input
                  className={styles.input}
                  aria-label="Your school’s Canvas address"
                  placeholder="yourschool.instructure.com"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  autoComplete="url"
                  inputMode="url"
                />
                <button type="submit" className={styles.primary} disabled={!origin}>Open Canvas</button>
              </form>
              {openedCanvas ? (
                <p className={styles.waiting}><span className={styles.pulse} aria-hidden="true" />Waiting for the first sync. Keep this tab open.</p>
              ) : (
                <p className={styles.hint}>Already have Canvas open? Reload that tab and it syncs.</p>
              )}
              {origin && !origin.endsWith('.instructure.com') && (
                <p className={styles.hint}>
                  On its own address? Once Canvas is open, click the Soma icon in Chrome’s toolbar and choose
                  <strong> Use Soma on this site</strong>.
                </p>
              )}
            </>
          )}
          {stage === 'done' && (
            <span className={styles.doneText}>
              {totals.courses} {totals.courses === 1 ? 'course' : 'courses'} and {totals.assignments} assignments from {sites.map(s => s.host).join(', ')}
            </span>
          )}
        </div>
      </li>

      {/* 3 — What came in, and the popup */}
      <li className={`${styles.item} ${styles[state('done')]}`}>
        <Mark state={state('done')} n={3} />
        <div className={styles.body}>
          <span className={styles.title}>{stage === 'done' ? 'You’re connected' : 'See what came in'}</span>
          {stage === 'done' && (
            <>
              {courses.length > 0 && (
                <ul className={styles.courses}>
                  {courses.slice(0, 6).map(c => (
                    <li key={c.id}>
                      <span className={styles.dot} style={{ background: colorOf(c.id, c.name) }} aria-hidden="true" />
                      <span className={styles.courseName}>{c.name}</span>
                      {c.currentGrade && <span className={styles.grade}>{c.currentGrade}</span>}
                    </li>
                  ))}
                  {courses.length > 6 && <li className={styles.more}>and {courses.length - 6} more</li>}
                </ul>
              )}
              {upcoming.length > 0 && (
                <div className={styles.next}>
                  <span className={styles.label}>Next up</span>
                  {upcoming.map(a => (
                    <div key={a.id} className={styles.due}>
                      <span className={styles.dueName}>{a.name}</span>
                      <span className={styles.dueWhen}>{dueLabel(a.dueAt)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className={styles.popup}>
                <span className={styles.label}>Pin it to your toolbar</span>
                <p className={styles.text}>
                  Click the puzzle piece in Chrome, then the pin next to Soma for Canvas. Its popup shows:
                </p>
                <ul className={styles.features}>
                  <li><strong>Due soon</strong>: what’s due in the next two days and not handed in</li>
                  <li><strong>What changed</strong>: new work, moved dates, posted grades</li>
                  <li><strong>Sync now</strong>: refresh without waiting the two hours</li>
                </ul>
                <p className={styles.hint}>Reminders come a day before and three hours before. Grades are on; turn off “Include grades and scores” in the popup to keep them out.</p>
              </div>
            </>
          )}
        </div>
      </li>
    </ol>
    </div>
  );
}
