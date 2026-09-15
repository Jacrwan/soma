import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { storage } from '../../lib/storage';
import { getIcalAssignments } from '../../lib/canvas';
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
  const [step, setStep] = useState<1 | 2 | 3 | 4>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('onboarding_source') ? 3 : 1;
  });

  // Clean up onboarding_source URL param on mount
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('onboarding_source')) {
      url.searchParams.delete('onboarding_source');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  // Step 1 — age
  const [birthday, setBirthday] = useState('');
  const [ageBlocked, setAgeBlocked] = useState(false);

  // Step 2 — education (restored from localStorage if returning from OAuth)
  const [education, setEducation] = useState<EducationId | ''>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('onboarding_source')) {
      return (localStorage.getItem('soma_ob_edu') as EducationId) || '';
    }
    return '';
  });

  // Step 3 — integrations
  const [canvasUrl, setCanvasUrl] = useState('');
  const [canvasError, setCanvasError] = useState('');
  const [canvasConnecting, setCanvasConnecting] = useState(false);
  const [canvasConnected, setCanvasConnected] = useState(!!storage.getCanvasIcalUrl());

  // Final save
  const [saving, setSaving] = useState(false);

  const firstName = userName.split(' ')[0] || 'there';
  const gdriveConnected = !!storage.getGoogleDriveToken();

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

  // ── Step 3 ────────────────────────────────────────────────────────────────

  async function connectCanvas() {
    const url = canvasUrl.trim();
    if (!url) return;
    setCanvasConnecting(true);
    setCanvasError('');
    try {
      const fetched = await getIcalAssignments(url);
      await storage.syncCanvasSubjects(fetched);
      storage.setCanvasIcalUrl(url);
      storage.setCachedIcalAssignments(fetched);
      storage.setCachedAssignments(fetched);
      storage.setCacheTimestamp(Date.now());
      setCanvasConnected(true);
    } catch (e: unknown) {
      setCanvasError(e instanceof Error ? e.message : 'Invalid URL. Check your Canvas calendar feed URL.');
    } finally {
      setCanvasConnecting(false);
    }
  }

  async function connectGoogle() {
    if (education) localStorage.setItem('soma_ob_edu', education);
    const redirectUrl = new URL(`${window.location.origin}/day-view`);
    redirectUrl.searchParams.set('onboarding_source', 'gdrive');
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: [
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/documents',
          'https://www.googleapis.com/auth/presentations',
        ].join(' '),
        redirectTo: redirectUrl.toString(),
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
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
        birthYear,
      });
      const localSettings = storage.getSomaSettings();
      storage.setSomaSettings({
        ...localSettings,
        onboardingCompleted: true,
        educationLevel: education || undefined,
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

        {/* ── STEP 3 — Integrations ─────────────────────────────────────── */}
        {step === 3 && (
          <div className={styles.step}>
            <h1 className={styles.heading}>Connect your tools</h1>
            <p className={styles.sub}>You can always do this later in Settings.</p>

            {/* Canvas */}
            <div className={styles.integBlock}>
              <div className={styles.integHeader}>
                <span className={styles.integTitle}>Canvas</span>
                {canvasConnected && <span className={styles.integBadge}>Connected</span>}
              </div>
              <p className={styles.integDesc}>
                Paste your Canvas calendar feed URL to sync assignments.
              </p>
              {!canvasConnected && (
                <>
                  <div className={styles.integRow}>
                    <input
                      className={styles.input}
                      type="url"
                      placeholder="https://school.instructure.com/feeds/calendars/..."
                      value={canvasUrl}
                      onChange={e => { setCanvasUrl(e.target.value); setCanvasError(''); }}
                    />
                    <button
                      className={styles.connectBtn}
                      onClick={connectCanvas}
                      disabled={!canvasUrl.trim() || canvasConnecting}
                    >
                      {canvasConnecting ? 'Connecting…' : 'Connect'}
                    </button>
                  </div>
                  {canvasError && <p className={styles.integError}>{canvasError}</p>}
                </>
              )}
            </div>

            {/* Google */}
            <div className={styles.integBlock}>
              <div className={styles.integHeader}>
                <span className={styles.integTitle}>Google</span>
                {gdriveConnected && <span className={styles.integBadge}>Connected</span>}
              </div>
              <p className={styles.integDesc}>
                Create Docs, Slides, and sync your Google Calendar.
              </p>
              {!gdriveConnected && (
                <button className={styles.connectBtn} onClick={connectGoogle}>
                  Connect Google
                </button>
              )}
            </div>

            <div className={styles.actions}>
              <button className={styles.backBtn} onClick={() => setStep(2)}>Back</button>
              <div className={styles.actionsRight}>
                <button className={styles.skipBtn} onClick={() => setStep(4)}>
                  Skip for now
                </button>
                <button className={styles.primaryBtn} onClick={() => setStep(4)}>
                  Continue
                </button>
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
