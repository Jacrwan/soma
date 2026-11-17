// What a Canvas item is in the game: an exam boss, a quiz, a project or plain
// work. Pure rules, no state: sim.js's classify() hands everything here.
//
// Returns { kind: 'boss' | 'invader', size: 1 | 2 | 3, label: 'exam' | 'quiz' | 'project' | 'assignment' }.
// weight is the share of the course grade the item's group carries, 0 to 100.

export const KINDS = ['boss', 'quiz', 'assignment'];

// Names are matched after lowercasing and turning _ - . / : into spaces, so
// "L18-Warm Up Quiz" and "Exam_2" read as words. Digits glued on ("Exam1",
// "Test2", "Midterm1") still count.
// A bare "Final" is the final exam; "Final Lab Report" or "Final Quiz" is not.
const EXAM = /\b(exams?\d*|examinations?|mid ?terms?\d*|prelims?\d*|tests?\d*|finals?\d*(?!\s+(lab|labs|report|homework|hw|problem|pset|assignment|code|submission|draft|version|reflection|essay|paper|project|presentation|portfolio|write ?up|reading|response|quiz|grade|review|survey|evaluation))|hour exam)\b/;
// "Unit 3 Assessment", "Chapter Assessment", "Assessment 2"; not self or peer assessment.
const ASSESSMENT = /\b((unit|chapter|module|summative|common|final)\s*\d*\s*assessments?|assessments?\s*#?\s*\d+)\b/;
const QUIZ = /\b(quiz(zes)?\d*|quizz?\d*)\b/;
// Long work handed in, not sat. "Final Project" and "Midterm Paper" are these.
const PROJECT = /\b(projects?\d*|capstone|portfolio|thesis|presentations?|poster|essays?\d*|papers?\d*|final (report|draft|version|submission|reflection))\b/;
// About an exam, not the exam: practice, review, corrections.
const ABOUT_EXAM = /\b(practice|mock|sample|review|prep|study guide|corrections?|wrappers?|reflections?|solutions?|answer key|sign ?up|request|makeup form|survey|evaluation|feedback|accommodations?)\b/;
// Software words that are not tests you sit.
const NOT_A_TEST = /\b(test (cases?|suites?|plan|driven|harness|run|submission|assignment|upload|post)|unit tests|testing)\b/;

const clean = (s) => String(s || '').toLowerCase().replace(/[_\-./:()[\]]+/g, ' ');

function examWords(text) {
  if (!text) return false;
  const t = text.replace(NOT_A_TEST, ' ');
  return EXAM.test(t) || ASSESSMENT.test(t);
}

/** Canvas says this is one of its quizzes (online, timed or not). */
/** Words in a description that mean the item is sat under watch. */
export const PROCTORED = /lockdown browser|respondus|honorlock|proctorio|proctoru|examity|proctored|exam room|testing center/i;

export function isCanvasQuiz(a) {
  return Boolean(a.isQuiz || a.quizId) || (Array.isArray(a.submissionTypes) && a.submissionTypes.includes('online_quiz'));
}

/** The guess, before sizes: which of the four things is it. */
export function guessLabel(a) {
  const name = clean(a.name);
  const group = clean(a.groupName);
  const points = a.pointsPossible || 0;

  // The name speaks first.
  if (PROJECT.test(name)) return 'project';
  if (examWords(name)) return ABOUT_EXAM.test(name) ? 'assignment' : 'exam';
  if (QUIZ.test(name)) return 'quiz';

  // Then the group it sits in ("Tests", "Midterms", "Quizzes", "Projects").
  const groupExam = examWords(group);
  const groupQuiz = QUIZ.test(group);
  if (groupExam && groupQuiz) return (a.weight || 0) >= 20 || points >= 100 ? 'exam' : 'quiz'; // "Exams & Quizzes"
  if (groupExam && !ABOUT_EXAM.test(name)) return 'exam';
  if (groupQuiz) return 'quiz';
  if (PROJECT.test(group)) return 'project';

  // Then what Canvas knows about how it is taken: a long or big Canvas quiz is
  // a test, and so is anything behind a lockdown browser or a proctor.
  const big = points >= 100 || (a.weight || 0) >= 20 || (a.timeLimit || 0) >= 50;
  if (a.proctored) return big || points >= 50 ? 'exam' : 'quiz';
  if (isCanvasQuiz(a)) return big ? 'exam' : 'quiz';
  return 'assignment';
}

function sizeFor(label, a) {
  const points = a.pointsPossible || 0;
  const weight = a.weight || 0;
  const heavy = weight >= 20 || points >= 100;
  if (label === 'exam') {
    // A tiny "test" worth almost nothing (a weekly 10-point check) is not a boss.
    const tiny = points > 0 && points < 25 && weight > 0 && weight < 10;
    return tiny ? 2 : 3;
  }
  if (label === 'quiz') {
    const light = (points > 0 && points <= 10) || (weight > 0 && weight <= 5);
    return light ? 1 : 2;
  }
  return heavy || points >= 50 ? 2 : 1;
}

/**
 * The game's reading of an item. override is the student's own call
 * ('boss' | 'quiz' | 'assignment') and wins over the guess.
 */
export function classifyItem(a, override = a.kindOverride) {
  let label = guessLabel(a);
  if (override === 'boss') label = 'exam';
  else if (override === 'quiz') label = 'quiz';
  else if (override === 'assignment' && (label === 'exam' || label === 'quiz')) label = 'assignment';
  let size = sizeFor(label, a);
  if (override === 'boss') size = 3;
  const kind = label === 'exam' && size === 3 ? 'boss' : 'invader';
  return { kind, size, label };
}
