import { useEffect, useMemo, useState } from 'react';
import {
  Quiz, QuizQuestion, QuestionKind,
  loadQuizzes, saveQuiz, deleteQuiz, newQuestion, newQuiz,
  normalizeAnswer, QUIZZES_EVENT,
} from '../../lib/quizzes';
import { Subject } from '../../types';
import { storage } from '../../lib/storage';
import { knowledgeStrike } from '../../lib/bosses';
import styles from './Quizzes.module.css';

type View =
  | { name: 'list' }
  | { name: 'edit'; quiz: Quiz }
  | { name: 'take'; quizId: string };

export default function QuizzesMode({ subjects, initialStudyId }: { subjects: Subject[]; initialStudyId?: string }) {
  const [quizzes, setQuizzes] = useState<Quiz[]>(loadQuizzes);
  const [view, setView] = useState<View>(
    initialStudyId && loadQuizzes().some((q) => q.id === initialStudyId)
      ? { name: 'take', quizId: initialStudyId }
      : { name: 'list' },
  );

  // Jump to take mode when initialStudyId changes (e.g. clicked from Library).
  useEffect(() => {
    if (initialStudyId && loadQuizzes().some((q) => q.id === initialStudyId)) {
      setView({ name: 'take', quizId: initialStudyId });
    }
  }, [initialStudyId]);

  useEffect(() => {
    const refresh = () => setQuizzes(loadQuizzes());
    window.addEventListener(QUIZZES_EVENT, refresh);
    return () => window.removeEventListener(QUIZZES_EVENT, refresh);
  }, []);

  if (view.name === 'edit') {
    return (
      <QuizEditor
        quiz={view.quiz}
        subjects={subjects}
        onDone={() => setView({ name: 'list' })}
        onTake={(id) => setView({ name: 'take', quizId: id })}
      />
    );
  }
  if (view.name === 'take') {
    const quiz = quizzes.find((q) => q.id === view.quizId);
    if (!quiz) return null;
    return <TakeQuiz quiz={quiz} onExit={() => setView({ name: 'list' })} />;
  }

  return (
    <QuizList
      quizzes={quizzes}
      subjects={subjects}
      onCreate={() => setView({ name: 'edit', quiz: newQuiz() })}
      onEdit={(quiz) => setView({ name: 'edit', quiz })}
      onTake={(id) => setView({ name: 'take', quizId: id })}
    />
  );
}

// ── List ───────────────────────────────────────────────────────────────────

function QuizList({ quizzes, subjects, onCreate, onEdit, onTake }: {
  quizzes: Quiz[];
  subjects: Subject[];
  onCreate: () => void;
  onEdit: (quiz: Quiz) => void;
  onTake: (id: string) => void;
}) {
  const subjectName = (id?: string) => (id ? subjects.find((s) => s.id === id)?.name : undefined);

  return (
    <div className={styles.wrap}>
      <div className={styles.listHeader}>
        <span className={styles.stepLabel}>Your quizzes</span>
        <button className={styles.primaryBtn} onClick={onCreate}>+ New quiz</button>
      </div>

      {quizzes.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No quizzes yet</p>
          <p className={styles.emptyText}>Write your own questions and take them right here in Soma — scored instantly, no Google Doc.</p>
          <button className={styles.primaryBtn} onClick={onCreate}>Create your first quiz</button>
        </div>
      ) : (
        <div className={styles.deckGrid}>
          {quizzes.map((quiz) => {
            const name = subjectName(quiz.subjectId);
            return (
              <div key={quiz.id} className={styles.deckCard}>
                <button className={styles.deckMain} onClick={() => onTake(quiz.id)}>
                  <span className={styles.deckTitle}>{quiz.title || 'Untitled quiz'}</span>
                  <span className={styles.deckMeta}>
                    {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'}{name ? ` · ${name}` : ''}
                  </span>
                </button>
                <div className={styles.deckActions}>
                  <button className={styles.studyBtn} onClick={() => onTake(quiz.id)}>Take</button>
                  <button className={styles.ghostBtn} onClick={() => onEdit(quiz)}>Edit</button>
                  <button className={styles.ghostBtn} onClick={() => { if (confirm('Delete this quiz?')) deleteQuiz(quiz.id); }}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Editor ─────────────────────────────────────────────────────────────────

function QuizEditor({ quiz: initial, subjects, onDone, onTake }: {
  quiz: Quiz;
  subjects: Subject[];
  onDone: () => void;
  onTake: (id: string) => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [subjectId, setSubjectId] = useState(initial.subjectId ?? '');
  const [questions, setQuestions] = useState<QuizQuestion[]>(
    initial.questions.length ? initial.questions : [newQuestion('choice')],
  );

  function patch(id: string, fields: Partial<QuizQuestion>) {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...fields } : q)));
  }
  function setKind(id: string, kind: QuestionKind) {
    setQuestions((prev) => prev.map((q) => {
      if (q.id !== id) return q;
      return { ...q, kind, options: kind === 'choice' && q.options.length < 2 ? ['', ''] : q.options };
    }));
  }
  function setOption(id: string, idx: number, value: string) {
    setQuestions((prev) => prev.map((q) => q.id === id
      ? { ...q, options: q.options.map((o, i) => (i === idx ? value : o)) }
      : q));
  }
  function addOption(id: string) {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, options: [...q.options, ''] } : q)));
  }
  function removeOption(id: string, idx: number) {
    setQuestions((prev) => prev.map((q) => {
      if (q.id !== id || q.options.length <= 2) return q;
      const options = q.options.filter((_, i) => i !== idx);
      const correctIndex = q.correctIndex >= options.length ? options.length - 1 : q.correctIndex;
      return { ...q, options, correctIndex };
    }));
  }
  function addQuestion() { setQuestions((prev) => [...prev, newQuestion('choice')]); }
  function removeQuestion(id: string) {
    setQuestions((prev) => (prev.length > 1 ? prev.filter((q) => q.id !== id) : prev));
  }

  const valid = questions.filter((q) => {
    if (!q.prompt.trim()) return false;
    if (q.kind === 'choice') return q.options.filter((o) => o.trim()).length >= 2;
    return q.answer.trim().length > 0;
  });
  const canSave = title.trim().length > 0 && valid.length > 0;

  function build(): Quiz {
    return {
      ...initial,
      title: title.trim(),
      subjectId: subjectId || undefined,
      questions: valid.map((q) => ({
        ...q,
        prompt: q.prompt.trim(),
        options: q.options.map((o) => o.trim()),
        answer: q.answer.trim(),
        explanation: q.explanation.trim(),
      })),
      updatedAt: new Date().toISOString(),
    };
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.listHeader}>
        <button className={styles.backBtn} onClick={onDone}>← Back</button>
        <span className={styles.stepLabel}>{initial.title ? 'Edit quiz' : 'New quiz'}</span>
      </div>

      <div className={styles.editorTop}>
        <input className={styles.input} placeholder="Quiz title — e.g. Cell biology check-in"
          value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        {subjects.length > 0 && (
          <select className={styles.input} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">No subject</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      <div className={styles.qEditList}>
        {questions.map((q, i) => (
          <div key={q.id} className={styles.qEditCard}>
            <div className={styles.qEditHead}>
              <span className={styles.qNum}>Q{i + 1}</span>
              <div className={styles.kindToggle}>
                <button className={`${styles.kindBtn}${q.kind === 'choice' ? ` ${styles.kindBtnActive}` : ''}`}
                  onClick={() => setKind(q.id, 'choice')}>Multiple choice</button>
                <button className={`${styles.kindBtn}${q.kind === 'written' ? ` ${styles.kindBtnActive}` : ''}`}
                  onClick={() => setKind(q.id, 'written')}>Written</button>
              </div>
              <button className={styles.removeBtn} onClick={() => removeQuestion(q.id)} disabled={questions.length === 1} aria-label="Remove question">×</button>
            </div>

            <textarea className={styles.qPrompt} placeholder="Question prompt" rows={2}
              value={q.prompt} onChange={(e) => patch(q.id, { prompt: e.target.value })} />

            {q.kind === 'choice' ? (
              <div className={styles.optionList}>
                {q.options.map((opt, idx) => (
                  <div key={idx} className={styles.optionRow}>
                    <button
                      className={`${styles.correctDot}${q.correctIndex === idx ? ` ${styles.correctDotOn}` : ''}`}
                      onClick={() => patch(q.id, { correctIndex: idx })}
                      title="Mark as correct answer"
                      aria-label="Mark as correct answer"
                    >{q.correctIndex === idx ? '✓' : ''}</button>
                    <input className={styles.optionInput} placeholder={`Option ${idx + 1}`}
                      value={opt} onChange={(e) => setOption(q.id, idx, e.target.value)} />
                    <button className={styles.removeOptBtn} onClick={() => removeOption(q.id, idx)} disabled={q.options.length <= 2} aria-label="Remove option">×</button>
                  </div>
                ))}
                <button className={styles.addOptBtn} onClick={() => addOption(q.id)}>+ Add option</button>
                <p className={styles.hint}>Tap the circle to mark the correct answer.</p>
              </div>
            ) : (
              <input className={styles.input} placeholder="Accepted answer"
                value={q.answer} onChange={(e) => patch(q.id, { answer: e.target.value })} />
            )}

            <input className={styles.explainInput} placeholder="Explanation (optional)"
              value={q.explanation} onChange={(e) => patch(q.id, { explanation: e.target.value })} />
          </div>
        ))}
      </div>

      <button className={styles.addCardBtn} onClick={addQuestion}>+ Add question</button>

      <div className={styles.editorActions}>
        <button className={styles.primaryBtn} disabled={!canSave}
          onClick={() => { const q = build(); saveQuiz(q); onTake(q.id); }}>Save & take</button>
        <button className={styles.secondaryBtn} disabled={!canSave}
          onClick={() => { saveQuiz(build()); onDone(); }}>Save</button>
      </div>
    </div>
  );
}

// ── Take ───────────────────────────────────────────────────────────────────

export function TakeQuiz({ quiz, onExit }: { quiz: Quiz; onExit: () => void }) {
  const [responses, setResponses] = useState<Record<string, string | number>>({});
  const [submitted, setSubmitted] = useState(false);

  function isCorrect(q: QuizQuestion): boolean {
    const r = responses[q.id];
    if (q.kind === 'choice') return r === q.correctIndex;
    return typeof r === 'string' && normalizeAnswer(r) === normalizeAnswer(q.answer);
  }

  function submit() {
    setSubmitted(true);
    // Knowledge strike: a graded quiz deals burst damage to the matching boss.
    if (quiz.subjectId) {
      const correct = quiz.questions.filter(isCorrect).length;
      knowledgeStrike(quiz.subjectId, storage.getCachedAssignments(), 10 + correct * 3);
    }
  }

  const score = useMemo(
    () => (submitted ? quiz.questions.filter(isCorrect).length : 0),
    [submitted, responses, quiz.questions], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const answeredCount = quiz.questions.filter((q) => responses[q.id] !== undefined && responses[q.id] !== '').length;
  const allAnswered = answeredCount === quiz.questions.length;

  return (
    <div className={styles.wrap}>
      <div className={styles.listHeader}>
        <button className={styles.backBtn} onClick={onExit}>← Quizzes</button>
        <span className={styles.stepLabel}>{quiz.title || 'Untitled quiz'}</span>
      </div>

      {submitted && (
        <div className={styles.scoreBanner}>
          <span className={styles.scoreNum}>{score}/{quiz.questions.length}</span>
          <span className={styles.scoreLbl}>{Math.round((score / quiz.questions.length) * 100)}% correct</span>
        </div>
      )}

      <div className={styles.takeList}>
        {quiz.questions.map((q, i) => {
          const r = responses[q.id];
          const correct = submitted && isCorrect(q);
          const wrong = submitted && !isCorrect(q);
          return (
            <div key={q.id} className={`${styles.takeCard}${correct ? ` ${styles.takeCorrect}` : ''}${wrong ? ` ${styles.takeWrong}` : ''}`}>
              <span className={styles.takeQNum}>Question {i + 1}</span>
              <p className={styles.takePrompt}>{q.prompt}</p>

              {q.kind === 'choice' ? (
                <div className={styles.takeOptions}>
                  {q.options.map((opt, idx) => {
                    const chosen = r === idx;
                    const showCorrect = submitted && idx === q.correctIndex;
                    return (
                      <button
                        key={idx}
                        className={`${styles.takeOption}${chosen ? ` ${styles.takeOptionChosen}` : ''}${showCorrect ? ` ${styles.takeOptionCorrect}` : ''}`}
                        onClick={() => !submitted && setResponses((p) => ({ ...p, [q.id]: idx }))}
                        disabled={submitted}
                      >{opt}</button>
                    );
                  })}
                </div>
              ) : (
                <input
                  className={styles.input}
                  placeholder="Your answer"
                  value={typeof r === 'string' ? r : ''}
                  onChange={(e) => setResponses((p) => ({ ...p, [q.id]: e.target.value }))}
                  disabled={submitted}
                />
              )}

              {submitted && (
                <div className={styles.review}>
                  {q.kind === 'written' && <p className={styles.reviewAnswer}>Answer: <strong>{q.answer}</strong></p>}
                  {q.explanation && <p className={styles.reviewExplain}>{q.explanation}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.editorActions}>
        {submitted ? (
          <>
            <button className={styles.primaryBtn} onClick={() => { setResponses({}); setSubmitted(false); }}>Retake</button>
            <button className={styles.secondaryBtn} onClick={onExit}>Done</button>
          </>
        ) : (
          <button className={styles.primaryBtn} onClick={submit} disabled={!allAnswered}>
            {allAnswered ? 'Submit' : `Answer all (${answeredCount}/${quiz.questions.length})`}
          </button>
        )}
      </div>
    </div>
  );
}
