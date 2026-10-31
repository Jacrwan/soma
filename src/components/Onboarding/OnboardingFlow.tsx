import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { storage } from '../../lib/storage';
import { CANVAS_CHANGED, deepSyncStatus } from '../../lib/canvasExtension';
import { listCalendarsForConnection, listConnections, startConnectFlow, updateSelectedCalendars } from '../../lib/googleCalendarConnections';
import { useSubscription } from '../../lib/subscription';
import { TRIAL_DAYS } from '../../lib/pricing';
import { TrialPlanForm } from '../Trial/TrialSetupModal';
import ExtensionSetup from './ExtensionSetup';
import type { University } from '../../lib/universities';
import UniversityPicker from '../shared/UniversityPicker';
import styles from './OnboardingFlow.module.css';

export const EDUCATION_OPTIONS = [
  { id: 'middle',  icon: '🏫', label: 'Middle School' },
  { id: 'high',    icon: '🎒', label: 'High School' },
  { id: 'college', icon: '🎓', label: 'College / University' },
  { id: 'grad',    icon: '📚', label: 'Graduate / Post-grad' },
  { id: 'other',   icon: '💼', label: 'Other' },
] as const;

export type EducationId = typeof EDUCATION_OPTIONS[number]['id'];

export const EDUCATION_LABELS: Record<EducationId, string> = {
  middle:  'Middle School',
  high:    'High School',
  college: 'College / University',
  grad:    'Graduate / Post-grad',
  other:   'Other',
};

const PROGRESS_KEY = 'soma_ob_progress';
type Step = 1 | 2 | 3 | 4 | 5 | 6;
type Progress = { step?: Step; birthday?: string; education?: EducationId | ''; university?: University | null; calendarTried?: boolean };
function readProgress(): Progress {
  try { return JSON.parse(sessionStorage.getItem(PROGRESS_KEY) ?? '{}') as Progress; } catch { return {}; }
}

/**
 * Whether this tab is partway through sign-up. Adding the extension reloads
 * the page and Google Calendar leaves for Google and back; either can take
 * longer than the five minutes App gives a new account, and sign-up must
 * pick up where it was, not end silently.
 */
export function onboardingInProgress(): boolean {
  return !!readProgress().step;
}

interface Props {
  userName: string;
  onComplete: () => void;
}

export default function OnboardingFlow({ userName, onComplete }: Props) {
  // Adding the extension means reloading this page, so the answers so far
  // are kept for the tab's lifetime.
  const [saved] = useState(readProgress);
  const [step, setStep] = useState<Step>(saved.step ?? 1);

  // Step 1 — age
  const [birthday, setBirthday] = useState(saved.birthday ?? '');
  const [ageBlocked, setAgeBlocked] = useState(false);

  // Step 2 — education
  const [education, setEducation] = useState<EducationId | ''>(saved.education ?? '');
  const [university, setUniversity] = useState<University | null>(saved.university ?? null);
  const asksUniversity = education === 'college' || education === 'grad';

  // Step 3 — Canvas, through the extension. Synced once a snapshot has landed.
  const [synced, setSynced] = useState(() => deepSyncStatus().length > 0);
  useEffect(() => {
    const refresh = () => setSynced(deepSyncStatus().length > 0);
    window.addEventListener(CANVAS_CHANGED, refresh);
    return () => window.removeEventListener(CANVAS_CHANGED, refresh);
  }, []);
  const keepProgress = (extra: Partial<Progress> = {}) => {
    try { sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({ step, birthday, education, university, ...extra })); } catch { /* blocked: they answer again */ }
  };

  // Step 4 — Google Calendar. Connecting leaves for Google and comes back to
  // Settings, where this flow opens again on this step.
  const [calendars, setCalendars] = useState<string[] | null>(null);
  useEffect(() => {
    if (step !== 4) return;
    let live = true;
    (async () => {
      const connections = await listConnections();
      if (live) setCalendars(connections.map(c => c.googleEmail));
      // A new connection shows no calendars until some are picked. Soma picks
      // the main one; Settings → Integrations changes it.
      const unpicked = connections.filter(c => c.selectedCalendars.length === 0);
      for (const c of unpicked) {
        const primary = (await listCalendarsForConnection(c.id)).filter(cal => cal.primary);
        if (primary.length) await updateSelectedCalendars(c.id, primary);
      }
      if (unpicked.length) window.dispatchEvent(new CustomEvent('soma_gcal_updated'));
    })().catch(() => { if (live) setCalendars(c => c ?? []); });
    return () => { live = false; };
  }, [step]);
  const calendarFailed = !!saved.calendarTried && calendars !== null && calendars.length === 0;
  function connectCalendar() {
    keepProgress({ step: 4, calendarTried: true });
    void startConnectFlow();
  }

  // Step 5 — the free trial, only for an account that has never had one.
  const subscription = useSubscription();
  const offersTrial = subscription.status === 'free' && !subscription.trialStart && !subscription.error;
  const trialUnknown = subscription.status === 'loading';
  useEffect(() => {
    if (step === 5 && !trialUnknown && !offersTrial) setStep(6);
  }, [step, trialUnknown, offersTrial]);

  // Final save
  const [saving, setSaving] = useState(false);

  const firstName = userName.split(' ')[0] || 'there';

  // ── Step 1 ────────────────────────────────────────────────────────────────

  function handleAgeNext() {
    if (!birthday) return;
    const dob = new Date(birthday);
    const today = new Date();
    const age = today.getFullYear() - dob.getFullYear()
      - (today < new Date(today.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0);
    if (age < 13) { setAgeBlocked(true); return; }
    setAgeBlocked(false);
    setStep(2);
  }

  // ── Completion ────────────────────────────────────────────────────────────

  async function saveAnswers() {
    try {
      const birthYear = birthday ? new Date(birthday).getFullYear() : undefined;
      const remoteSettings = await storage.getSettings();
      await storage.saveSettings({
        ...remoteSettings,
        onboardingCompleted: true,
        educationLevel: education || undefined,
        university: asksUniversity && university ? university : undefined,
        birthYear,
      });
      const localSettings = storage.getSomaSettings();
      storage.setSomaSettings({
        ...localSettings,
        onboardingCompleted: true,
        educationLevel: education || undefined,
        university: asksUniversity && university ? university : undefined,
        birthYear,
      });
    } catch { /* fail silently */ }
    localStorage.removeItem('soma_ob_edu');
    try { sessionStorage.removeItem(PROGRESS_KEY); } catch { /* nothing kept */ }
  }

  async function handleComplete() {
    setSaving(true);
    await saveAnswers();
    setSaving(false);
    onComplete();
  }

  // ── Consent line (shared across steps) ───────────────────────────────────

  const consent = (
    <p className={styles.consent}>
      By using Soma you agree to our{' '}
      <Link to="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</Link>
      {' '}and{' '}
      <Link to="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>.
      {' '}Your data may be used to improve Soma.
    </p>
  );

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>

        {/* Logo */}
        <div className={styles.logo}>
          <svg className={styles.logoMark} width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 1L8.1 5.9L13 7L8.1 8.1L7 13L5.9 8.1L1 7L5.9 5.9Z"/>
          </svg>
          <span className={styles.logoName}>Soma</span>
        </div>

        {/* Progress dots (every step but the welcome) */}
        {step <= 5 && (
          <div className={styles.progress} aria-label={`Step ${step} of 5`}>
            {[1, 2, 3, 4, 5].map(n => (
              <div key={n} className={`${styles.dot}${step >= n ? ` ${styles.dotFilled}` : ''}`} />
            ))}
          </div>
        )}

        {/* ── STEP 1 — Age ──────────────────────────────────────────────── */}
        {step === 1 && (
          <div className={styles.step}>
            <h1 className={styles.heading}>First, confirm your age</h1>
            <p className={styles.sub}>Required for compliance. We only store your birth year.</p>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="ob-dob">Date of birth</label>
              <input
                id="ob-dob"
                className={styles.input}
                type="date"
                value={birthday}
                max={new Date().toISOString().split('T')[0]}
                onChange={e => { setBirthday(e.target.value); setAgeBlocked(false); }}
              />
            </div>

            {ageBlocked && (
              <div className={styles.ageBlock}>
                Soma is not available for users under 13. If you believe this is an error,{' '}
                <a href="mailto:support@somastudy.app">contact support</a>.
              </div>
            )}

            <div className={styles.actions}>
              <button
                className={styles.primaryBtn}
                onClick={handleAgeNext}
                disabled={!birthday || ageBlocked}
              >
                Continue
              </button>
            </div>

            {consent}
          </div>
        )}

        {/* ── STEP 2 — Education ────────────────────────────────────────── */}
        {step === 2 && (
          <div className={styles.step}>
            <h1 className={styles.heading}>What best describes you?</h1>

            <div className={styles.educationGrid}>
              {EDUCATION_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  className={[
                    styles.educationCard,
                    education === opt.id ? styles.educationCardActive : '',
                    opt.id === 'other' ? styles.educationCardFull : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setEducation(opt.id)}
                >
                  <span className={styles.educationIcon}>{opt.icon}</span>
                  <span className={styles.educationLabel}>{opt.label}</span>
                </button>
              ))}
            </div>

            {asksUniversity && (
              <div className={styles.universityBlock}>
                <label className={styles.universityLabel}>
                  Which university? <span className={styles.optional}>Optional</span>
                </label>
                <UniversityPicker value={university} onChange={setUniversity} />
              </div>
            )}

            <div className={styles.actions}>
              <button className={styles.backBtn} onClick={() => setStep(1)}>Back</button>
              <button
                className={styles.primaryBtn}
                disabled={!education}
                onClick={() => {
                  if (education) localStorage.setItem('soma_ob_edu', education);
                  setStep(3);
                }}
              >
                Continue
              </button>
            </div>

            {consent}
          </div>
        )}

        {/* ── STEP 3 — Canvas, through the extension ───────────────────── */}
        {step === 3 && (
          <div className={styles.step}>
            <h1 className={styles.heading}>Bring in Canvas</h1>
            <p className={styles.sub}>Soma for Canvas reads your courses, due dates and grades in your own browser, and keeps Soma up to date on its own.</p>

            <ExtensionSetup onBeforeReload={() => keepProgress()} />

            <div className={styles.actions}>
              <button className={styles.backBtn} onClick={() => setStep(2)}>Back</button>
              <div className={styles.actionsRight}>
                {synced
                  ? <button className={styles.primaryBtn} onClick={() => setStep(4)}>Continue</button>
                  : <button className={styles.skipBtn} onClick={() => setStep(4)}>Skip for now</button>}
              </div>
            </div>

            {consent}
          </div>
        )}

        {/* ── STEP 4 — Google Calendar ─────────────────────────────────── */}
        {step === 4 && (
          <div className={styles.step}>
            <h1 className={styles.heading}>Add your Google Calendar</h1>
            <p className={styles.sub}>Soma plans study time around your classes, work and plans, so nothing lands on top of them. It only reads your calendar and never changes it.</p>

            {calendars === null ? (
              <span className={styles.integDesc}>Checking…</span>
            ) : calendars.length > 0 ? (
              <div className={styles.integBlock}>
                {calendars.map(email => (
                  <div key={email} className={styles.integHeader}>
                    <span className={styles.integTitle}>{email}</span>
                    <span className={styles.integBadge}>Connected</span>
                  </div>
                ))}
                <span className={styles.integDesc}>Your main calendar shows in Soma. Add others, or another account, in Settings → Integrations.</span>
              </div>
            ) : (
              <div>
                <button className={styles.primaryBtn} onClick={connectCalendar}>Connect Google Calendar</button>
                {calendarFailed && (
                  <p className={styles.integError}>Google didn’t connect. Try again, or skip and connect it later in Settings.</p>
                )}
              </div>
            )}

            <div className={styles.actions}>
              <button className={styles.backBtn} onClick={() => setStep(3)}>Back</button>
              <div className={styles.actionsRight}>
                {calendars && calendars.length > 0
                  ? <button className={styles.primaryBtn} onClick={() => setStep(5)}>Continue</button>
                  : <button className={styles.skipBtn} onClick={() => setStep(5)}>Skip for now</button>}
              </div>
            </div>

            {consent}
          </div>
        )}

        {/* ── STEP 5 — Free trial ───────────────────────────────────────── */}
        {step === 5 && (
          <div className={styles.step}>
            <h1 className={styles.heading}>Try everything free for {TRIAL_DAYS} days</h1>
            <p className={styles.sub}>The trial adds the AI: it plans your week around what’s due, answers questions about your documents and courses, and reshuffles your day when plans change.</p>

            {trialUnknown ? (
              <span className={styles.integDesc}>Checking…</span>
            ) : (
              // Answers are saved first: Stripe comes back to the dashboard, not here.
              <TrialPlanForm from="onboarding" onBeforeCheckout={saveAnswers} />
            )}

            <div className={styles.actions}>
              <button className={styles.backBtn} onClick={() => setStep(4)}>Back</button>
              <button className={styles.skipBtn} onClick={() => setStep(6)}>Not now</button>
            </div>

            {consent}
          </div>
        )}

        {/* ── STEP 6 — Welcome ──────────────────────────────────────────── */}
        {step === 6 && (
          <div className={`${styles.step} ${styles.welcome}`}>
            <div className={styles.welcomeCheck} aria-hidden="true">✓</div>
            <h1 className={styles.heading}>You're all set, {firstName}!</h1>
            <p className={styles.sub}>Your study workspace is ready. Let's get to work.</p>
            <button
              className={styles.primaryBtn}
              onClick={handleComplete}
              disabled={saving}
            >
              {saving ? 'Setting up…' : 'Start using Soma'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
