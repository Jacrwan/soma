import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { storage, SomaSettings } from '../../lib/storage';
import { applyTheme } from '../../App';
import { supabase } from '../../lib/supabase';
import { friendlyError } from '../../lib/errors';
import { useSubscription, openBillingPortal } from '../../lib/subscription';
import { getIcalAssignments } from '../../lib/canvas';
import styles from './SettingsTab.module.css';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
type Day = typeof DAYS[number];
type HoursCategory = 'schoolHours' | 'workHours' | 'personalHours';
type Section = 'profile' | 'subscription' | 'appearance' | 'availability' | 'study' | 'ai' | 'integrations';

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function SettingsTab() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<SomaSettings>(() => storage.getSomaSettings());
  const [activeSection, setActiveSection] = useState<Section>('profile');
  const subscription = useSubscription();
  const [subLoading, setSubLoading] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);

  // Profile state
  const [profileEmail, setProfileEmail]       = useState('');
  const [profileName, setProfileName]         = useState('');
  const [isEmailProvider, setIsEmailProvider] = useState(false);
  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError]     = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading]     = useState(false);
  const [deleteError, setDeleteError]         = useState<string | null>(null);

  // Canvas integration state
  const [canvasIcalUrl, setCanvasIcalUrl] = useState(() => storage.getCanvasIcalUrl());
  const [showCanvasModal, setShowCanvasModal] = useState(false);
  const [canvasIcalInput, setCanvasIcalInput] = useState('');
  const [canvasConnecting, setCanvasConnecting] = useState(false);
  const [canvasError, setCanvasError] = useState('');

  // Local data state
  const [clearDataLoading, setClearDataLoading] = useState(false);

  // Google Calendar integration state
  const [gcalToken, setGcalToken] = useState(() => storage.getGoogleToken());

  // Google Docs integration state
  const [gdocsToken, setGdocsToken] = useState(() => storage.getGoogleDocsToken());

  // On mount (and after OAuth redirect back), pull provider_token from session.
  // Uses ?source=gcal / ?source=gdocs to distinguish which token to save.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const source = params.get('source');

    supabase.auth.getSession().then(({ data }) => {
      const pt = data.session?.provider_token;
      if (!pt) return;

      if (source === 'gdocs') {
        storage.setGoogleDocsToken(pt);
        setGdocsToken(pt);
        const url = new URL(window.location.href);
        url.searchParams.delete('source');
        window.history.replaceState({}, '', url.toString());
      } else if (source === 'gcal') {
        storage.setGoogleToken(pt);
        setGcalToken(pt);
        const url = new URL(window.location.href);
        url.searchParams.delete('source');
        window.history.replaceState({}, '', url.toString());
      }
    });
  }, []);

  // Load profile info
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (!u) return;
      setProfileEmail(u.email ?? '');
      setProfileName(u.user_metadata?.full_name ?? u.user_metadata?.name ?? '');
      setIsEmailProvider(u.app_metadata?.provider === 'email');
    });
  }, []);

  function save(next: SomaSettings) {
    setSettings(next);
    storage.setSomaSettings(next);
  }

  function setDayField(cat: HoursCategory, day: Day, field: 'start' | 'end', value: string) {
    save({
      ...settings,
      [cat]: {
        ...settings[cat],
        [day]: { ...settings[cat][day], [field]: value },
      },
    });
  }

  function addBlocked(cat: HoursCategory, day: Day) {
    const prev = settings[cat][day];
    save({
      ...settings,
      [cat]: {
        ...settings[cat],
        [day]: { ...prev, blocked: [...prev.blocked, { start: '15:00', end: '16:00' }] },
      },
    });
  }

  function setBlocked(cat: HoursCategory, day: Day, index: number, field: 'start' | 'end', value: string) {
    const prev = settings[cat][day];
    const blocked = prev.blocked.map((b, i) => i === index ? { ...b, [field]: value } : b);
    save({
      ...settings,
      [cat]: { ...settings[cat], [day]: { ...prev, blocked } },
    });
  }

  function removeBlocked(cat: HoursCategory, day: Day, index: number) {
    const prev = settings[cat][day];
    save({
      ...settings,
      [cat]: {
        ...settings[cat],
        [day]: { ...prev, blocked: prev.blocked.filter((_, i) => i !== index) },
      },
    });
  }

  function renderDayRows(cat: HoursCategory) {
    return DAYS.map(day => {
      const avail = settings[cat][day];
      return (
        <div key={day} className={styles.dayRow}>
          <div className={styles.dayHeader}>
            <span className={styles.dayLabel}>{capitalize(day)}</span>
            <div className={styles.timeRange}>
              <input
                type="time"
                className={styles.timeInput}
                value={avail.start}
                onChange={e => setDayField(cat, day, 'start', e.target.value)}
              />
              <span className={styles.timeSep}>to</span>
              <input
                type="time"
                className={styles.timeInput}
                value={avail.end}
                onChange={e => setDayField(cat, day, 'end', e.target.value)}
              />
              <button
                className={styles.addBlockedBtn}
                onClick={() => addBlocked(cat, day)}
              >+ blocked</button>
            </div>
          </div>
          {avail.blocked.length > 0 && (
            <div className={styles.blockedTags}>
              {avail.blocked.map((block, i) => (
                <div key={i} className={styles.blockedTag}>
                  <input
                    type="time"
                    className={styles.tagTime}
                    value={block.start}
                    onChange={e => setBlocked(cat, day, i, 'start', e.target.value)}
                  />
                  <span className={styles.tagDash}>–</span>
                  <input
                    type="time"
                    className={styles.tagTime}
                    value={block.end}
                    onChange={e => setBlocked(cat, day, i, 'end', e.target.value)}
                  />
                  <button
                    className={styles.tagRemove}
                    onClick={() => removeBlocked(cat, day, i)}
                    title="Remove"
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    });
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    setPasswordLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setPasswordError(friendlyError('auth'));
    } else {
      setPasswordSuccess('Password updated.');
      setNewPassword('');
      setConfirmPassword('');
    }
    setPasswordLoading(false);
  }

  async function handleDeleteAccount() {
    if (!window.confirm('Are you sure? This will permanently delete your account and all your data.')) return;
    setDeleteLoading(true);
    setDeleteError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { setDeleteLoading(false); return; }
    try {
      const res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setDeleteError(friendlyError('data'));
        setDeleteLoading(false);
        return;
      }
      await supabase.auth.signOut();
      window.location.href = '/';
    } catch {
      setDeleteError(friendlyError('general'));
      setDeleteLoading(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  async function connectIcal() {
    const url = canvasIcalInput.trim();
    if (!url) return;
    setCanvasConnecting(true);
    setCanvasError('');
    try {
      const fetched = await getIcalAssignments(url);
      storage.setCanvasIcalUrl(url);
      storage.setCachedIcalAssignments(fetched);
      storage.setCachedAssignments(fetched);
      storage.setCacheTimestamp(Date.now());
      setCanvasIcalUrl(url);
      setShowCanvasModal(false);
      setCanvasIcalInput('');
    } catch (e: unknown) {
      setCanvasError(e instanceof Error ? e.message : 'Invalid calendar feed URL.');
    } finally {
      setCanvasConnecting(false);
    }
  }

  function disconnectIcal() {
    storage.setCanvasIcalUrl('');
    storage.setCachedIcalAssignments([]);
    storage.setCachedAssignments([]);
    setCanvasIcalUrl('');
  }

  function handleClearLocalData() {
    if (!window.confirm('This will remove all cached Canvas data, Google events, access tokens, and app preferences from this browser. This cannot be undone. Continue?')) return;
    setClearDataLoading(true);
    try {
      storage.clearLocalData();
      // Reload so the app re-initialises from a clean state
      window.location.reload();
    } catch {
      setClearDataLoading(false);
    }
  }

  async function connectGcal() {
    const redirectUrl = new URL(window.location.origin + '/settings');
    redirectUrl.searchParams.set('source', 'gcal');
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/calendar.readonly',
        redirectTo: redirectUrl.toString(),
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
  }

  function disconnectGcal() {
    storage.setGoogleToken('');
    storage.setCachedGoogleEvents([]);
    storage.setGoogleCacheTimestamp(0);
    setGcalToken('');
    window.dispatchEvent(new CustomEvent('soma_gcal_updated'));
  }

  async function connectGdocs() {
    const redirectUrl = new URL(window.location.origin + '/settings');
    redirectUrl.searchParams.set('source', 'gdocs');
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/documents',
        redirectTo: redirectUrl.toString(),
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
  }

  function disconnectGdocs() {
    storage.setGoogleDocsToken('');
    setGdocsToken('');
  }

  const navItems: [Section, string][] = [
    ['profile',       'Profile'],
    ['subscription',  'Subscription'],
    ['appearance',    'Appearance'],
    ['availability',  'Availability'],
    ['study',         'Study Preferences'],
    ['ai',            'AI Behavior'],
    ['integrations',  'Integrations'],
  ];

  return (
    <>
    <div className={styles.settingsLayout}>
      <nav className={styles.settingsNav}>
        <span className={styles.settingsNavLabel}>Settings</span>
        {navItems.map(([key, label]) => (
          <button
            key={key}
            className={`${styles.settingsNavItem}${activeSection === key ? ` ${styles.settingsNavItemActive}` : ''}`}
            onClick={() => setActiveSection(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className={styles.settingsContent}>

        {activeSection === 'profile' && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Profile</h2>

            {/* Signed in as */}
            <div className={styles.profileBlock}>
              <span className={styles.profileLabel}>Signed in as</span>
              {profileName && <span className={styles.profileName}>{profileName}</span>}
              <span className={styles.profileEmail}>{profileEmail}</span>
            </div>

            <div className={styles.profileSep} />

            {/* Change password */}
            <div className={styles.profileBlock}>
              <span className={styles.profileLabel}>Change password</span>
              {isEmailProvider ? (
                <form onSubmit={handlePasswordChange} className={styles.profilePassForm}>
                  <input
                    className={styles.profilePassInput}
                    type="password"
                    placeholder="New password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    required
                  />
                  <input
                    className={styles.profilePassInput}
                    type="password"
                    placeholder="Confirm password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    required
                  />
                  {passwordError   && <p className={styles.profileMsgError}>{passwordError}</p>}
                  {passwordSuccess && <p className={styles.profileMsgOk}>{passwordSuccess}</p>}
                  <button className={styles.profilePassBtn} type="submit" disabled={passwordLoading}>
                    {passwordLoading ? 'Updating…' : 'Update password'}
                  </button>
                </form>
              ) : (
                <span className={styles.profileGoogleNote}>Password is managed by Google.</span>
              )}
            </div>

            <div className={styles.profileSep} />

            {/* Sign out */}
            <div className={styles.profileBlock}>
              <span className={styles.profileLabel}>Session</span>
              <div>
                <button className={styles.profileSignOutBtn} onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            </div>

            <div className={styles.profileSep} />

            {/* Danger zone */}
            <div className={styles.profileBlock}>
              <span className={styles.profileLabel}>Danger zone</span>
              <div className={styles.dangerZoneActions}>
                <div className={styles.dangerZoneItem}>
                  <div className={styles.dangerZoneText}>
                    <span className={styles.dangerZoneName}>Clear local Soma data</span>
                    <span className={styles.dangerZoneDesc}>Removes cached Canvas data, Google events, tokens, and preferences from this browser only</span>
                  </div>
                  <button
                    className={styles.profileDeleteBtn}
                    onClick={handleClearLocalData}
                    disabled={clearDataLoading}
                  >
                    {clearDataLoading ? 'Clearing…' : 'Clear data'}
                  </button>
                </div>
                <div className={styles.dangerZoneItem}>
                  <div className={styles.dangerZoneText}>
                    <span className={styles.dangerZoneName}>Delete account</span>
                    <span className={styles.dangerZoneDesc}>Permanently deletes your account and all server-side data</span>
                  </div>
                  {deleteError && <p className={styles.profileMsgError}>{deleteError}</p>}
                  <button
                    className={styles.profileDeleteBtn}
                    onClick={handleDeleteAccount}
                    disabled={deleteLoading}
                  >
                    {deleteLoading ? 'Deleting…' : 'Delete account'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeSection === 'subscription' && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Subscription</h2>

            <div className={styles.subBlock}>
              <div className={styles.subRow}>
                <span className={styles.subLabel}>Plan</span>
                <span className={`${styles.subBadge} ${
                  subscription.status === 'trialing'                 ? styles.subBadgeTrial :
                  subscription.status === 'trial_extended'           ? styles.subBadgeTrial :
                  subscription.status === 'active'                   ? styles.subBadgeActive :
                  subscription.status === 'loading'                  ? styles.subBadgeLoading :
                  styles.subBadgeFree
                }`}>
                  {subscription.status === 'loading'                  ? '—' :
                   subscription.status === 'trialing'                 ? 'Free trial' :
                   subscription.status === 'trial_expired'            ? 'Trial ended' :
                   subscription.status === 'trial_extended'           ? 'Extended trial' :
                   subscription.status === 'trial_extension_expired'  ? 'Trial ended' :
                   subscription.status === 'active'                   ? 'Premium' :
                   subscription.status === 'canceled'                 ? 'Canceled' :
                   subscription.status === 'past_due'                 ? 'Past due' :
                   'Free'}
                </span>
              </div>

              {subscription.status === 'trialing' && subscription.trialEndsAt && (
                <div className={styles.subRow}>
                  <span className={styles.subLabel}>Trial ends</span>
                  <span className={styles.subValue}>
                    {new Date(subscription.trialEndsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              )}

              {subscription.status === 'trial_extended' && subscription.extensionEndsAt && (
                <div className={styles.subRow}>
                  <span className={styles.subLabel}>Extension ends</span>
                  <span className={styles.subValue}>
                    {new Date(subscription.extensionEndsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              )}

              {subscription.status === 'active' && subscription.currentPeriodEnd && (
                <div className={styles.subRow}>
                  <span className={styles.subLabel}>
                    {subscription.cancelAtPeriodEnd ? 'Access ends' : 'Renews'}
                  </span>
                  <span className={styles.subValue}>
                    {new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              )}

              {subscription.cancelAtPeriodEnd && (
                <p className={styles.subNote}>Your subscription is set to cancel at the end of the billing period.</p>
              )}

              {subError && <p className={styles.subError}>{subError}</p>}
            </div>

            <div className={styles.subActions}>
              {subscription.status === 'free' && (
                <button className={styles.subBtnPrimary} onClick={() => navigate('/pricing')}>
                  Start free 3-week trial
                </button>
              )}

              {(subscription.status === 'trial_expired' || subscription.status === 'trial_extension_expired') && (
                <button className={styles.subBtnPrimary} onClick={() => navigate('/pricing')}>
                  {subscription.status === 'trial_expired' ? 'Get 7 more days free' : 'Subscribe — $4.99/mo'}
                </button>
              )}

              {(subscription.status === 'trial_extended' || subscription.status === 'active') && (
                <button
                  className={styles.subBtn}
                  disabled={subLoading}
                  onClick={async () => {
                    setSubLoading(true);
                    setSubError(null);
                    try { await openBillingPortal(); }
                    catch { setSubError('Could not open billing portal.'); setSubLoading(false); }
                  }}
                >
                  {subLoading ? 'Loading…' : 'Manage subscription'}
                </button>
              )}
            </div>
          </section>
        )}

        {activeSection === 'appearance' && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Appearance</h2>
            <div className={styles.prefGrid}>
              <div className={styles.prefRow}>
                <label className={styles.prefLabel}>Theme</label>
                <div className={styles.themeToggle}>
                  <button
                    className={`${styles.themeBtn}${(settings.theme ?? 'dark') === 'light' ? ` ${styles.themeBtnActive}` : ''}`}
                    onClick={() => {
                      const next = { ...settings, theme: 'light' as const };
                      save(next);
                      applyTheme('light');
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                      <circle cx="7" cy="7" r="2.5"/>
                      <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M3.05 3.05l1.06 1.06M9.89 9.89l1.06 1.06M10.95 3.05l-1.06 1.06M4.11 9.89l-1.06 1.06"/>
                    </svg>
                    Light
                  </button>
                  <button
                    className={`${styles.themeBtn}${(settings.theme ?? 'dark') === 'dark' ? ` ${styles.themeBtnActive}` : ''}`}
                    onClick={() => {
                      const next = { ...settings, theme: 'dark' as const };
                      save(next);
                      applyTheme('dark');
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                      <path d="M11.5 9A5.5 5.5 0 0 1 5 2.5a5.5 5.5 0 1 0 6.5 6.5Z"/>
                    </svg>
                    Dark
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeSection === 'availability' && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Availability</h2>

            <div className={styles.subsection}>
              <div className={styles.subsectionHeader}>
                <h3 className={styles.subsectionTitle}>School hours</h3>
                <button
                  className={`${styles.categoryToggle}${settings.schoolHoursEnabled !== false ? ` ${styles.categoryToggleOn}` : ''}`}
                  onClick={() => save({ ...settings, schoolHoursEnabled: settings.schoolHoursEnabled === false })}
                >{settings.schoolHoursEnabled !== false ? 'Enabled' : 'Disabled'}</button>
              </div>
              <p className={styles.subsectionHint}>When you're in class — unavailable for studying</p>
              <div className={`${styles.availabilityList}${settings.schoolHoursEnabled === false ? ` ${styles.availabilityListDisabled}` : ''}`}>{renderDayRows('schoolHours')}</div>
            </div>

            <div className={styles.subsection}>
              <div className={styles.subsectionHeader}>
                <h3 className={styles.subsectionTitle}>Work hours</h3>
                <button
                  className={`${styles.categoryToggle}${settings.workHoursEnabled !== false ? ` ${styles.categoryToggleOn}` : ''}`}
                  onClick={() => save({ ...settings, workHoursEnabled: settings.workHoursEnabled === false })}
                >{settings.workHoursEnabled !== false ? 'Enabled' : 'Disabled'}</button>
              </div>
              <p className={styles.subsectionHint}>When you're at work — unavailable for studying</p>
              <div className={`${styles.availabilityList}${settings.workHoursEnabled === false ? ` ${styles.availabilityListDisabled}` : ''}`}>{renderDayRows('workHours')}</div>
            </div>

            <div className={styles.subsection}>
              <div className={styles.subsectionHeader}>
                <h3 className={styles.subsectionTitle}>Personal hours</h3>
                <button
                  className={`${styles.categoryToggle}${settings.personalHoursEnabled !== false ? ` ${styles.categoryToggleOn}` : ''}`}
                  onClick={() => save({ ...settings, personalHoursEnabled: settings.personalHoursEnabled === false })}
                >{settings.personalHoursEnabled !== false ? 'Enabled' : 'Disabled'}</button>
              </div>
              <p className={styles.subsectionHint}>Your free window — available for studying</p>
              <div className={`${styles.availabilityList}${settings.personalHoursEnabled === false ? ` ${styles.availabilityListDisabled}` : ''}`}>{renderDayRows('personalHours')}</div>
            </div>
          </section>
        )}

        {activeSection === 'study' && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Study Preferences</h2>
            <div className={styles.prefGrid}>
              <div className={styles.prefRow}>
                <label className={styles.prefLabel}>Default session length</label>
                <select
                  className={styles.prefSelect}
                  value={settings.studyPrefs.defaultSessionMinutes}
                  onChange={e => save({ ...settings, studyPrefs: { ...settings.studyPrefs, defaultSessionMinutes: Number(e.target.value) } })}
                >
                  {[30, 45, 60, 90].map(m => (
                    <option key={m} value={m}>{m} min</option>
                  ))}
                </select>
              </div>

              <div className={styles.prefRow}>
                <label className={styles.prefLabel}>Default break duration</label>
                <select
                  className={styles.prefSelect}
                  value={settings.studyPrefs.defaultBreakMinutes}
                  onChange={e => save({ ...settings, studyPrefs: { ...settings.studyPrefs, defaultBreakMinutes: Number(e.target.value) } })}
                >
                  {[5, 10, 15, 20].map(m => (
                    <option key={m} value={m}>{m} min</option>
                  ))}
                </select>
              </div>

              <div className={styles.prefRow}>
                <label className={styles.prefLabel}>Preferred study start time</label>
                <input
                  type="time"
                  className={styles.timeInput}
                  value={settings.studyPrefs.preferredStartTime}
                  onChange={e => save({ ...settings, studyPrefs: { ...settings.studyPrefs, preferredStartTime: e.target.value } })}
                />
              </div>
            </div>
          </section>
        )}

        {activeSection === 'ai' && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>AI Behavior</h2>
            <div className={styles.prefGrid}>
              <div className={styles.prefRow}>
                <label className={styles.prefLabel}>Response verbosity</label>
                <div className={styles.segment}>
                  <button
                    className={`${styles.segBtn}${settings.aiPrefs.verbosity === 'concise' ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => save({ ...settings, aiPrefs: { ...settings.aiPrefs, verbosity: 'concise' } })}
                  >Concise</button>
                  <button
                    className={`${styles.segBtn}${settings.aiPrefs.verbosity === 'detailed' ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => save({ ...settings, aiPrefs: { ...settings.aiPrefs, verbosity: 'detailed' } })}
                  >Detailed</button>
                </div>
              </div>

              <div className={styles.prefRow}>
                <label className={styles.prefLabel}>When I ask to plan my day</label>
                <div className={styles.segment}>
                  <button
                    className={`${styles.segBtn}${settings.aiPrefs.defaultOutput === 'schedule' ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => save({ ...settings, aiPrefs: { ...settings.aiPrefs, defaultOutput: 'schedule' } })}
                  >Schedule</button>
                  <button
                    className={`${styles.segBtn}${settings.aiPrefs.defaultOutput === 'todos' ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => save({ ...settings, aiPrefs: { ...settings.aiPrefs, defaultOutput: 'todos' } })}
                  >Todos</button>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeSection === 'integrations' && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Integrations</h2>
            <div className={styles.integrationList}>

              {/* Canvas — Calendar Feed (iCal) */}
              <div className={styles.integrationRow}>
                <div className={styles.integrationInfo}>
                  <span className={styles.integrationLabel}>Canvas</span>
                  <span className={styles.integrationDescription}>Sync assignment due dates via your Canvas calendar feed URL</span>
                </div>
                <div className={styles.integrationActions}>
                  {canvasIcalUrl ? (
                    <>
                      <span className={styles.connectedBadge}>Connected</span>
                      <button className={styles.disconnectBtn} onClick={disconnectIcal}>Disconnect</button>
                    </>
                  ) : (
                    <button className={styles.connectBtn} onClick={() => { setCanvasError(''); setShowCanvasModal(true); }}>Connect</button>
                  )}
                </div>
              </div>

              <div className={styles.integrationRow}>
                <div className={styles.integrationInfo}>
                  <span className={styles.integrationLabel}>Google Calendar</span>
                  <span className={styles.integrationDescription}>See your events alongside your schedule</span>
                </div>
                <div className={styles.integrationActions}>
                  {gcalToken ? (
                    <>
                      <span className={styles.connectedBadge}>Connected</span>
                      <button className={styles.disconnectBtn} onClick={disconnectGcal}>Disconnect</button>
                    </>
                  ) : (
                    <button className={styles.connectBtn} onClick={connectGcal}>Connect</button>
                  )}
                </div>
              </div>

              <div className={styles.integrationRow}>
                <div className={styles.integrationInfo}>
                  <span className={styles.integrationLabel}>Google Docs</span>
                  <span className={styles.integrationDescription}>Save AI responses directly to a Google Doc</span>
                </div>
                <div className={styles.integrationActions}>
                  {gdocsToken ? (
                    <>
                      <span className={styles.connectedBadge}>Connected</span>
                      <button className={styles.disconnectBtn} onClick={disconnectGdocs}>Disconnect</button>
                    </>
                  ) : (
                    <button className={styles.connectBtn} onClick={connectGdocs}>Connect</button>
                  )}
                </div>
              </div>

            </div>
          </section>
        )}

      </div>
    </div>

    {/* Canvas connect modal */}
    {showCanvasModal && (
      <div className={styles.modalOverlay} onClick={() => setShowCanvasModal(false)}>
        <div className={styles.modalBox} onClick={e => e.stopPropagation()}>
          <span className={styles.modalTitle}>Connect Canvas</span>
          <div className={styles.modalHint}>
            Paste your Canvas calendar feed URL to sync assignment due dates — no token needed.
          </div>
          <div className={styles.modalField}>
            <label className={styles.modalLabel}>Canvas Calendar Feed URL</label>
            <input
              className={styles.modalInput}
              placeholder="https://school.instructure.com/feeds/calendars/user_…ics"
              value={canvasIcalInput}
              autoFocus
              onChange={e => setCanvasIcalInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') connectIcal(); if (e.key === 'Escape') setShowCanvasModal(false); }}
            />
          </div>
          {canvasError && <span className={styles.modalError}>{canvasError}</span>}
          <div className={styles.modalHint}>
            <strong>How to get your calendar URL:</strong><br />
            Canvas → Calendar → scroll to bottom right → Calendar Feed → copy the link
          </div>
          <div className={styles.modalActions}>
            <button
              className={styles.modalSubmit}
              onClick={connectIcal}
              disabled={canvasConnecting || !canvasIcalInput.trim()}
            >{canvasConnecting ? 'Connecting…' : 'Connect'}</button>
            <button className={styles.modalCancel} onClick={() => setShowCanvasModal(false)}>Cancel</button>
          </div>
        </div>
      </div>
    )}

</>
  );
}
