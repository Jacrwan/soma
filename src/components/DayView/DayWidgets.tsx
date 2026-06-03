import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getWeeklyStudyTime, getStudyStreak } from '../../lib/insights';
import { loadDecks, FLASHCARDS_EVENT } from '../../lib/flashcards';
import { loadQuizzes, QUIZZES_EVENT } from '../../lib/quizzes';
import { Subject } from '../../types';
import styles from './DayWidgets.module.css';

function fmtHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// ── This-week glance (links to Insights) ───────────────────────────────────────

export function WeekGlance() {
  const navigate = useNavigate();
  const [minutes, setMinutes] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    let live = true;
    getWeeklyStudyTime(0).then((days) => {
      if (live) setMinutes(days.reduce((s, d) => s + d.minutes, 0));
    }).catch(() => {});
    getStudyStreak().then((s) => { if (live) setStreak(s); }).catch(() => {});
    return () => { live = false; };
  }, []);

  if (minutes === null) return null;

  return (
    <button className={styles.glance} onClick={() => navigate('/insights')}>
      <div className={styles.glanceItem}>
        <span className={styles.glanceValue}>{fmtHm(minutes)}</span>
        <span className={styles.glanceLabel}>this week</span>
      </div>
      <div className={styles.glanceDivider} />
      <div className={styles.glanceItem}>
        <span className={styles.glanceValue}>{streak > 0 ? `🔥 ${streak}` : '—'}</span>
        <span className={styles.glanceLabel}>day streak</span>
      </div>
      <span className={styles.glanceArrow}>›</span>
    </button>
  );
}

// ── Study sets (flashcards + quizzes), launched into study in the Create tab ────

type SetItem = { id: string; title: string; tool: 'flashcards' | 'quiz'; count: number; subjectId?: string; ts: number };

export function StudySets({ subjects }: { subjects: Subject[] }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<SetItem[]>([]);

  useEffect(() => {
    function refresh() {
      const decks = loadDecks().map((d): SetItem => ({
        id: d.id, title: d.title || 'Untitled deck', tool: 'flashcards',
        count: d.cards.length, subjectId: d.subjectId, ts: new Date(d.updatedAt).getTime(),
      }));
      const quizzes = loadQuizzes().map((q): SetItem => ({
        id: q.id, title: q.title || 'Untitled quiz', tool: 'quiz',
        count: q.questions.length, subjectId: q.subjectId, ts: new Date(q.updatedAt).getTime(),
      }));
      setItems([...decks, ...quizzes].sort((a, b) => b.ts - a.ts));
    }
    refresh();
    window.addEventListener(FLASHCARDS_EVENT, refresh);
    window.addEventListener(QUIZZES_EVENT, refresh);
    return () => {
      window.removeEventListener(FLASHCARDS_EVENT, refresh);
      window.removeEventListener(QUIZZES_EVENT, refresh);
    };
  }, []);

  const subjectName = (id?: string) => (id ? subjects.find((s) => s.id === id)?.name : undefined);

  function study(item: SetItem) {
    navigate('/create', { state: { study: { tool: item.tool, id: item.id } } });
  }

  return (
    <div className={styles.studySets}>
      <div className={styles.studyHeader}>
        <span className={styles.studyTitle}>Study sets</span>
        <button className={styles.studyManage} onClick={() => navigate('/create')}>＋ New</button>
      </div>
      {items.length === 0 ? (
        <p className={styles.studyEmpty}>
          No flashcards or quizzes yet. <button className={styles.studyLink} onClick={() => navigate('/create')}>Make one</button> to study here.
        </p>
      ) : (
        <div className={styles.setList}>
          {items.slice(0, 6).map((item) => {
            const name = subjectName(item.subjectId);
            return (
              <button key={`${item.tool}-${item.id}`} className={styles.setRow} onClick={() => study(item)}>
                <span className={styles.setIcon}>{item.tool === 'quiz' ? '🧠' : '📇'}</span>
                <span className={styles.setInfo}>
                  <span className={styles.setTitle}>{item.title}</span>
                  <span className={styles.setMeta}>
                    {item.count} {item.tool === 'quiz' ? 'question' : 'card'}{item.count === 1 ? '' : 's'}
                    {name ? ` · ${name}` : ''}
                  </span>
                </span>
                <span className={styles.setAction}>{item.tool === 'quiz' ? 'Take' : 'Study'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
