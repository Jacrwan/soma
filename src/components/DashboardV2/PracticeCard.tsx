import { useState } from 'react';
import { practiceQuestions, cachedPractice, setsLeft, type PracticeSet } from '../../lib/practice';
import { aiErrorMessage } from '../../lib/aiResponse';
import styles from './PracticeCard.module.css';

/**
 * Practice questions in the Focus panel, for the block being worked on:
 * four multiple-choice questions from the course's own documents, checked as
 * they're answered. Nothing is saved to the plan; marking sections done
 * stays with the student's own check-off.
 */
export default function PracticeCard({ subjectId, subject, task, sections }: { subjectId?: string; subject: string; task: string; sections?: string[] }) {
  const [set, setSet] = useState<PracticeSet | undefined>(() => cachedPractice(subject, task));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<Record<number, number>>({});

  async function load(fresh = false) {
    setBusy(true); setError('');
    try {
      const next = await practiceQuestions({ subjectId, subject, task, sections, fresh });
      setSet(next); setPicked({}); setOpen(true);
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setError(code === 'practice_limit' ? 'That’s today’s practice for this block. More tomorrow.' : aiErrorMessage(e));
    } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <div className={styles.practice}>
        <button type="button" onClick={() => (set ? setOpen(true) : void load())} disabled={busy}>
          {busy ? 'Writing questions…' : set ? 'Practice questions' : 'Practice questions on this'}
        </button>
        {error && <p role="alert" className={styles.note}>{error}</p>}
      </div>
    );
  }

  const answered = Object.keys(picked).length;
  const right = set!.questions.filter((q, i) => picked[i] === q.answer).length;
  const left = setsLeft(subject, task);
  return (
    <section className={styles.practice} aria-label="Practice questions">
      <div className={styles.head}>
        <strong>Practice</strong>
        <span className={styles.note}>{set!.sources.length ? `From ${set!.sources.join(', ')}` : 'No course documents matched; general questions'}</span>
      </div>
      <ol className={styles.questions}>
        {set!.questions.map((q, i) => {
          const choice = picked[i];
          return (
            <li key={i}>
              <fieldset className={styles.question}>
                <legend>{q.q}</legend>
                {q.choices.map((c, j) => {
                  const state = choice === undefined ? '' : j === q.answer ? styles.right : j === choice ? styles.wrong : '';
                  return (
                    <label key={j} className={`${styles.choice} ${state}`}>
                      <input type="radio" name={`practice-${i}`} checked={choice === j} disabled={choice !== undefined} onChange={() => setPicked(p => ({ ...p, [i]: j }))} />
                      <span>{c}</span>
                    </label>
                  );
                })}
                {choice !== undefined && (
                  <p className={styles.why} role="status">{choice === q.answer ? 'Right. ' : `Not quite: it's “${q.choices[q.answer]}”. `}{q.why}</p>
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>
      {answered === set!.questions.length && (
        <p className={styles.score} role="status">{right} of {set!.questions.length} right.{right < set!.questions.length ? ' Worth another look before you check this block off.' : ''}</p>
      )}
      <div className={styles.actions}>
        <button type="button" onClick={() => void load(true)} disabled={busy || left === 0}>{busy ? 'Writing…' : 'New questions'}</button>
        <button type="button" onClick={() => setOpen(false)}>Hide</button>
      </div>
      {error && <p role="alert" className={styles.note}>{error}</p>}
    </section>
  );
}
