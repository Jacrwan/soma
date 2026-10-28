import { useState } from 'react';
import { Play } from 'lucide-react';
import type { Subject } from '../../types';
import { storage } from '../../lib/storage';
import styles from './DashboardV2.module.css';

/**
 * Start focus without planning a block first: pick a course (the last one
 * used is preselected), optionally say what you're on, and go. With no
 * courses yet, the session is filed under "General" so it still saves.
 */

const LAST = 'soma_quick_focus_subject';

function readLast(): string | null {
  try { return localStorage.getItem(LAST); } catch { return null; }
}

export default function QuickFocus({ subjects, onStart }: { subjects: Subject[]; onStart: (subject: Subject, task: string) => void }) {
  const open = subjects.filter(s => !s.archived);
  const [subjectId, setSubjectId] = useState(() => {
    const last = readLast();
    return open.find(s => s.id === last)?.id ?? open[0]?.id ?? '';
  });
  const [task, setTask] = useState('');

  function start() {
    let subject = open.find(s => s.id === subjectId) ?? open[0];
    if (!subject) {
      subject = storage.getSubjects().find(s => s.name === 'General' && !s.archived)
        ?? { id: crypto.randomUUID(), name: 'General', color: '#26c6da', totalTimeToday: 0, source: 'manual' };
      if (!storage.getSubjects().some(s => s.id === subject!.id)) storage.setSubjects([...storage.getSubjects(), subject]);
    }
    try { localStorage.setItem(LAST, subject.id); } catch { /* remembered next time only */ }
    onStart(subject, task.trim() || `${subject.name} focus`);
  }

  return (
    <form className={styles.quickFocus} onSubmit={e => { e.preventDefault(); start(); }}>
      {open.length > 0 && (
        <select aria-label="Course" value={subjectId} onChange={e => setSubjectId(e.target.value)}>
          {open.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <input aria-label="What are you working on? (optional)" placeholder="What are you working on? (optional)" value={task} maxLength={120} onChange={e => setTask(e.target.value)} />
      <button type="submit" className={styles.quickStart}><Play size={14} /> Start focus</button>
    </form>
  );
}
