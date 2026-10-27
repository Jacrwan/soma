import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { storage } from '../../lib/storage';
import { CANVAS_CHANGED, EXTENSION_STORE_URL, extensionPresent } from '../../lib/canvasExtension';
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

interface Props {
  userName: string;
  onComplete: () => void;
}

export default function OnboardingFlow({ userName, onComplete }: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1 — age
  const [birthday, setBirthday] = useState('');
  const [ageBlocked, setAgeBlocked] = useState(false);

  // Step 2 — education
  const [education, setEducation] = useState<EducationId | ''>('');
  const [university, setUniversity] = useState<University | null>(null);
  const asksUniversity = education === 'college' || education === 'grad';


  // Step 3 — the extension: the bridge says so when it is installed
  const [extensionHere, setExtensionHere] = useState(() => !!extensionPresent());
  useEffect(() => {
    const refresh = () => setExtensionHere(!!extensionPresent());
    window.addEventListener(CANVAS_CHANGED, refresh);
    return () => window.removeEventListener(CANVAS_CHANGED, refresh);
  }, []);

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

  async function handleComplete() {
    setSaving(true);
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

        {/* Progress dots (steps 1–3 only) */}
        {step <= 3 && (
          <div className={styles.progress} aria-label={`Step ${step} of 3`}>
            {[1, 2, 3].map(n => (
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

        {/* ── STEP 3 — Soma for Canvas extension ─────────────────────────── */}
        {step === 3 && (
          <div className={styles.step}>
            <h1 className={styles.heading}>Add the Soma for Canvas extension</h1>
            <p className={styles.sub}>Optional. It reads Canvas in your own browser so Soma also has points, submissions, grades and announcements, and keeps itself up to date.</p>

            <div className={styles.integBlock}>
              <div className={styles.integHeader}>
                <span className={styles.integTitle}>How it works</span>
                {extensionHere && <span className={styles.integBadge}>Installed</span>}
              </div>
              <ol className={styles.integDesc}>
                <li>Add it to Chrome from the Chrome Web Store (it also works in Edge and Brave).</li>
                <li>Open Canvas in that browser and sign in as usual. The extension reads your courses from the page you are already signed in to.</li>
                <li>Keep Soma open in a tab once. Your grades and assignment details show up in Soma, and it syncs on its own after that.</li>
              </ol>
              <p className={styles.integDesc}>It never sees your Canvas password. You can see or remove what it synced in Settings.</p>
              {!extensionHere && (
                <a className={styles.connectBtn} href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer">
                  Add to Chrome
                </a>
              )}
            </div>

            <div className={styles.actions}>
              <button className={styles.backBtn} onClick={() => setStep(2)}>Back</button>
              <div className={styles.actionsRight}>
                {!extensionHere && <button className={styles.skipBtn} onClick={() => setStep(4)}>Skip for now</button>}
                <button className={styles.primaryBtn} onClick={() => setStep(4)}>Continue</button>
              </div>
            </div>

            {consent}
          </div>
        )}

        {/* ── STEP 4 — Welcome ──────────────────────────────────────────── */}
        {step === 4 && (
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
