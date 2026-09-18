import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { storage, SomaSettings } from '../../lib/storage';
import SemesterEndModal from '../shared/SemesterEndModal';
import { EDUCATION_OPTIONS, EDUCATION_LABELS, type EducationId } from '../Onboarding/OnboardingFlow';
import { applyTheme } from '../../App';
import { applyTimeFormat } from '../../lib/timeFormat';
import { supabase } from '../../lib/supabase';
import { friendlyError } from '../../lib/errors';
import { useSubscription, openBillingPortal, hasAIAccess, getGoogleCalendarLimit, GOOGLE_CALENDAR_LIMIT_PREMIUM } from '../../lib/subscription';
import { getIcalAssignments } from '../../lib/canvas';
import {
  listConnections, listCalendarsForConnection, updateSelectedCalendars, disconnectConnection, startConnectFlow,
} from '../../lib/googleCalendarConnections';
import { SUBJECT_COLORS, nextUnusedColor } from '../../lib/subjectColors';
import type { GoogleCalendarConnection, GoogleCalendarInfo, Subject, SubjectColor } from '../../types';
import styles from './SettingsTab.module.css';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
type Day = typeof DAYS[number];
type HoursCategory = 'schoolHours' | 'workHours' | 'personalHours';
type Section = 'profile' | 'subscription' | 'appearance' | 'availability' | 'study' | 'ai' | 'integrations' | 'courses';

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

  // Education level
  const [educationLevel, setEducationLevel]   = useState<string>(() => storage.getSomaSettings().educationLevel || '');
  const [editingEducation, setEditingEducation] = useState(false);
  const [pendingEducation, setPendingEducation] = useState<EducationId | ''>('');
  const [eduSaving, setEduSaving]             = useState(false);

  // Canvas integration state
  const [canvasIcalUrl, setCanvasIcalUrl] = useState(() => storage.getCanvasIcalUrl());
  const [showCanvasModal, setShowCanvasModal] = useState(false);
  const [canvasIcalInput, setCanvasIcalInput] = useState('');
  const [canvasConnecting, setCanvasConnecting] = useState(false);
  const [canvasError, setCanvasError] = useState('');

  // getCanvasIcalUrl() above reads an in-memory value populated
  // asynchronously by loadTokens(). If Settings mounts before that resolves
  // (e.g. direct navigation to /settings), the Integrations row can show
  // "Connect" for an account that's already connected — re-check once
  // loading settles.
  useEffect(() => {
    if (canvasIcalUrl) return;
    let cancelled = false;
    storage.whenTokensLoaded().then(() => {
      if (cancelled) return;
      const latest = storage.getCanvasIcalUrl();
      if (latest) setCanvasIcalUrl(latest);
    });
    return () => { cancelled = true; };
  }, [canvasIcalUrl]);

  // Local data state
  const [clearDataLoading, setClearDataLoading] = useState(false);

  // Supabase settings save
  const [savedSection, setSavedSection] = useState<string | null>(null);
  const [supabaseSaving, setSupabaseSaving] = useState(false);

  async function saveToSupabase(section: string, nextSettings?: SomaSettings) {
    setSupabaseSaving(true);
    try {
      await storage.saveSettings(nextSettings ?? settings);
      setSavedSection(section);
      setTimeout(() => setSavedSection(s => s === section ? null : s), 2000);
    } catch { /* silent */ } finally {
      setSupabaseSaving(false);
    }
  }

  // Semester archive
  const [showSemesterModal, setShowSemesterModal] = useState(false);
  const [archiveDone, setArchiveDone] = useState(false);
  const [subjects, setSubjectsState] = useState<Subject[]>(() => storage.getSubjects());
  const activeSubjects = subjects.filter(s => !s.archived);
  const archivedSubjects = subjects.filter(s => s.archived);

  // Course editing state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [paletteId, setPaletteId] = useState<string | null>(null);
  const [addingCourse, setAddingCourse] = useState(false);
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseColor, setNewCourseColor] = useState<SubjectColor>(SUBJECT_COLORS[0]);
  const [courseError, setCourseError] = useState('');

  // Courses live in Supabase, so pick up the loaded list and any change made
  // elsewhere (Canvas sync, the dashboard's block editor).
  useEffect(() => {
    const sync = () => setSubjectsState(storage.getSubjects());
    void storage.loadSubjects().then(sync).catch(sync);
    window.addEventListener('soma_subjects_changed', sync);
    return () => window.removeEventListener('soma_subjects_changed', sync);
  }, []);

  function commitSubjects(next: Subject[]) {
    storage.setSubjects(next);
    setSubjectsState(next);
    window.dispatchEvent(new Event('soma_subjects_changed'));
  }

  function archiveCanvasCourses() {
    commitSubjects(storage.getSubjects().map(s => s.source === 'canvas' ? { ...s, archived: true } : s));
    setShowSemesterModal(false);
    setArchiveDone(true);
  }

  function restoreSubject(id: string) {
    commitSubjects(storage.getSubjects().map(s => s.id === id ? { ...s, archived: false } : s));
  }

  function deleteArchivedSubject(id: string) {
    commitSubjects(storage.getSubjects().filter(s => s.id !== id));
  }

  function archiveSubject(id: string) {
    commitSubjects(storage.getSubjects().map(s => s.id === id ? { ...s, archived: true } : s));
  }

  function recolorSubject(id: string, color: SubjectColor) {
    commitSubjects(storage.getSubjects().map(s => s.id === id ? { ...s, color } : s));
    setPaletteId(null);
  }

  function saveRename(id: string) {
    const name = renameDraft.trim();
    if (!name) { setRenamingId(null); return; }
    commitSubjects(storage.getSubjects().map(s => s.id === id ? { ...s, name } : s));
    setRenamingId(null);
  }

  function addCourse() {
    const name = newCourseName.trim();
    if (!name) return;
    const current = storage.getSubjects();
    if (current.some(s => !s.archived && s.name.toLowerCase() === name.toLowerCase())) {
      setCourseError('You already have a course with that name.');
      return;
    }
    commitSubjects([...current, {
      id: crypto.randomUUID(), name, color: newCourseColor,
      totalTimeToday: 0, archived: false, source: 'manual',
    }]);
    setNewCourseName('');
    setCourseError('');
    setAddingCourse(false);
  }

  // Google Calendar integration state — multiple connected accounts, each
  // with its own set of calendars to sync.
  const [gcalConnections, setGcalConnections] = useState<GoogleCalendarConnection[]>([]);
  const [gcalConnectMsg, setGcalConnectMsg] = useState('');
  const [gcalActionError, setGcalActionError] = useState('');
  const [expandedConnectionId, setExpandedConnectionId] = useState<string | null>(null);
  const [availableCalendars, setAvailableCalendars] = useState<Record<string, GoogleCalendarInfo[]>>({});
  const [calendarsLoadingId, setCalendarsLoadingId] = useState<string | null>(null);

  const gcalLimit = getGoogleCalendarLimit(subscription.status);
  const gcalAtLimit = gcalConnections.length >= gcalLimit;

  const loadGcalConnections = () => { void listConnections().then(setGcalConnections).catch(() => {}); };

  // On mount (including right after the OAuth redirect back from the connect
  // flow, which lands here via /api/google-calendar-oauth-callback), load
  // the current connections and surface any ?gcal_connected / ?gcal_error param.
  useEffect(() => {
    loadGcalConnections();

    const params = new URLSearchParams(window.location.search);
    const connected = params.get('gcal_connected');
    const error = params.get('gcal_error');
    if (connected) setGcalConnectMsg(`Connected ${connected}`);
    if (error?.startsWith('limit_reached_')) {
      const limit = error.slice('limit_reached_'.length);
      setGcalActionError(`You've reached your limit of ${limit} connected Google accounts.`);
    } else if (error) {
      setGcalActionError(`Couldn't connect Google Calendar (${error}). Try again.`);
    }
    if (connected || error) {
      const url = new URL(window.location.href);
      url.searchParams.delete('gcal_connected');
      url.searchParams.delete('gcal_error');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  async function toggleExpandConnection(connection: GoogleCalendarConnection) {
    if (expandedConnectionId === connection.id) {
      setExpandedConnectionId(null);
      return;
    }
    setExpandedConnectionId(connection.id);
    if (!availableCalendars[connection.id]) {
      setCalendarsLoadingId(connection.id);
      setGcalActionError('');
      try {
        const calendars = await listCalendarsForConnection(connection.id);
        setAvailableCalendars(prev => ({ ...prev, [connection.id]: calendars }));
      } catch {
        setGcalActionError('Could not load calendars for that account — reconnect it and try again.');
      } finally {
        setCalendarsLoadingId(null);
      }
    }
  }

  async function toggleCalendarSelected(connection: GoogleCalendarConnection, cal: GoogleCalendarInfo) {
    const isSelected = connection.selectedCalendars.some(c => c.id === cal.id);
    const nextSelected = isSelected
      ? connection.selectedCalendars.filter(c => c.id !== cal.id)
      : [...connection.selectedCalendars, cal];

    setGcalConnections(prev => prev.map(c => c.id === connection.id ? { ...c, selectedCalendars: nextSelected } : c));
    try {
      await updateSelectedCalendars(connection.id, nextSelected);
      storage.setGoogleCacheTimestamp(0); // force Calendar tab to refetch with the new selection
      window.dispatchEvent(new CustomEvent('soma_gcal_updated'));
    } catch {
      setGcalConnections(prev => prev.map(c => c.id === connection.id ? connection : c));
      setGcalActionError("Couldn't update that calendar's selection. Try again.");
    }
  }

  async function handleDisconnectGcal(connection: GoogleCalendarConnection) {
    setGcalConnections(prev => prev.filter(c => c.id !== connection.id));
    try {
      await disconnectConnection(connection.id);
      storage.setGoogleCacheTimestamp(0);
      window.dispatchEvent(new CustomEvent('soma_gcal_updated'));
    } catch {
      loadGcalConnections();
      setGcalActionError("Couldn't disconnect that account. Try again.");
    }
  }

  // Load profile info
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (!u) return;
      // Google-provider sessions don't always populate top-level `email`
      // immediately after OAuth; fall back to metadata/identity so this
      // field doesn't render blank for a genuinely signed-in user.
      const email = u.email
        || (u.user_metadata?.email as string | undefined)
        || u.identities?.find(i => i.identity_data?.email)?.identity_data?.email
        || '';
      setProfileEmail(email);
      setProfileName(u.user_metadata?.full_name ?? u.user_metadata?.name ?? '');
      setIsEmailProvider(u.app_metadata?.provider === 'email');
    });
  }, []);

  // Load education level from Supabase (cross-device)
  useEffect(() => {
    storage.getSettings().then(s => {
      if (s.educationLevel) setEducationLevel(s.educationLevel);
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

  // Filling in 3 categories × 7 days × 2 time fields one at a time is the
  // exact kind of manual planning tedium Soma's own pitch says it removes.
  // These let one edited day fan out across the rest of the week instead of
  // requiring 14 separate field edits per category.
  function copyMondayTo(cat: HoursCategory, days: Day[]) {
    const monday = settings[cat].monday;
    const nextCat = { ...settings[cat] };
    for (const day of days) {
      nextCat[day] = { start: monday.start, end: monday.end, blocked: monday.blocked.map(b => ({ ...b })) };
    }
    save({ ...settings, [cat]: nextCat });
  }

  const WEEKDAYS: Day[] = ['tuesday', 'wednesday', 'thursday', 'friday'];
  const ALL_OTHER_DAYS: Day[] = ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

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

  async function handleSaveEducation() {
    if (!pendingEducation) return;
    setEduSaving(true);
    try {
      const remote = await storage.getSettings();
      await storage.saveSettings({ ...remote, educationLevel: pendingEducation });
      const local = storage.getSomaSettings();
      storage.setSomaSettings({ ...local, educationLevel: pendingEducation });
      setEducationLevel(pendingEducation);
      setEditingEducation(false);
    } catch { /* fail silently */ }
    setEduSaving(false);
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
      await storage.syncCanvasSubjects(fetched);
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

  const navItems: [Section, string][] = [
    ['profile',       'Profile'],
    ['subscription',  'Subscription'],
    ['appearance',    'Appearance'],
    ['availability',  'Availability'],
    ['study',         'Study Preferences'],
    ['ai',            'AI Behavior'],
    ['integrations',  'Integrations'],
    ['courses',       'Courses'],
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

            {/* Education level */}
            <div className={styles.profileBlock}>
              <span className={styles.profileLabel}>Education level</span>
              {!editingEducation ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className={styles.profileName} style={{ fontWeight: 500 }}>
                    {educationLevel
                      ? EDUCATION_LABELS[educationLevel as EducationId]
                      : <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}>Not set</span>}
                  </span>
                  <button
                    className={styles.profilePassBtn}
                    style={{ padding: '4px 12px', fontSize: 11 }}
                    onClick={() => {
                      setPendingEducation((educationLevel as EducationId) || '');
                      setEditingEducation(true);
                    }}
                  >
                    Edit
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {EDUCATION_OPTIONS.map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => setPendingEducation(opt.id)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 4,
                          padding: '10px 6px',
                          borderRadius: 10,
                          border: `1.5px solid ${pendingEducation === opt.id ? 'var(--accent)' : 'var(--border)'}`,
                          background: pendingEducation === opt.id ? 'color-mix(in oklch, var(--accent) 8%, transparent)' : 'var(--bg-secondary)',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          transition: 'border-color 0.15s, background 0.15s',
                          ...(opt.id === 'other' ? { gridColumn: '1 / -1' } : {}),
                        }}
                      >
                        <span style={{ fontSize: 15 }}>{opt.icon}</span>
                        <span style={{ fontSize: 11, fontWeight: 500, textAlign: 'center' }}>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className={styles.profilePassBtn}
                      onClick={handleSaveEducation}
                      disabled={!pendingEducation || eduSaving}
                    >
                      {eduSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      className={styles.profileGoogleNote as unknown as string}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: 'var(--text-muted)', padding: '7px 4px' }}
                      onClick={() => setEditingEducation(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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
                    catch (err) { setSubError(err instanceof Error ? err.message : 'Could not open billing portal.'); setSubLoading(false); }
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

              <div className={styles.prefRow}>
                <label className={styles.prefLabel}>Time format</label>
                <div className={styles.themeToggle}>
                  <button
                    className={`${styles.themeBtn}${(settings.timeFormat ?? '12h') === '12h' ? ` ${styles.themeBtnActive}` : ''}`}
                    aria-pressed={(settings.timeFormat ?? '12h') === '12h'}
                    onClick={() => {
                      const next = { ...settings, timeFormat: '12h' as const };
                      save(next);
                      applyTimeFormat('12h');
                    }}
                  >12-hour <span className={styles.prefHint}>1:30 PM</span></button>
                  <button
                    className={`${styles.themeBtn}${(settings.timeFormat ?? '12h') === '24h' ? ` ${styles.themeBtnActive}` : ''}`}
                    aria-pressed={(settings.timeFormat ?? '12h') === '24h'}
                    onClick={() => {
                      const next = { ...settings, timeFormat: '24h' as const };
                      save(next);
                      applyTimeFormat('24h');
                    }}
                  >24-hour <span className={styles.prefHint}>13:30</span></button>
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
              <div className={styles.subsectionHintRow}>
                <p className={styles.subsectionHint}>When you're in class — unavailable for studying</p>
                <button type="button" className={styles.copyToAllBtn} onClick={() => copyMondayTo('schoolHours', WEEKDAYS)}>
                  Copy Monday to weekdays
                </button>
              </div>
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
              <div className={styles.subsectionHintRow}>
                <p className={styles.subsectionHint}>When you're at work — unavailable for studying</p>
                <button type="button" className={styles.copyToAllBtn} onClick={() => copyMondayTo('workHours', WEEKDAYS)}>
                  Copy Monday to weekdays
                </button>
              </div>
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
              <div className={styles.subsectionHintRow}>
                <p className={styles.subsectionHint}>Your free window — available for studying</p>
                <button type="button" className={styles.copyToAllBtn} onClick={() => copyMondayTo('personalHours', ALL_OTHER_DAYS)}>
                  Copy Monday to all days
                </button>
              </div>
              <div className={`${styles.availabilityList}${settings.personalHoursEnabled === false ? ` ${styles.availabilityListDisabled}` : ''}`}>{renderDayRows('personalHours')}</div>
            </div>

            <div className={styles.saveRow}>
              <button
                className={styles.saveBtn}
                disabled={supabaseSaving}
                onClick={() => void saveToSupabase('availability')}
              >
                {savedSection === 'availability' ? 'Saved ✓' : 'Save'}
              </button>
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

            <div className={styles.saveRow}>
              <button
                className={styles.saveBtn}
                disabled={supabaseSaving}
                onClick={() => void saveToSupabase('study')}
              >
                {savedSection === 'study' ? 'Saved ✓' : 'Save'}
              </button>
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
                    onClick={() => { const n = { ...settings, aiPrefs: { ...settings.aiPrefs, verbosity: 'concise' as const } }; save(n); void saveToSupabase('ai', n); }}
                  >Concise</button>
                  <button
                    className={`${styles.segBtn}${settings.aiPrefs.verbosity === 'detailed' ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => { const n = { ...settings, aiPrefs: { ...settings.aiPrefs, verbosity: 'detailed' as const } }; save(n); void saveToSupabase('ai', n); }}
                  >Detailed</button>
                </div>
              </div>

              <div className={styles.prefRow}>
                <label className={styles.prefLabel}>When I ask to plan my day</label>
                <div className={styles.segment}>
                  <button
                    className={`${styles.segBtn}${settings.aiPrefs.defaultOutput === 'schedule' ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => { const n = { ...settings, aiPrefs: { ...settings.aiPrefs, defaultOutput: 'schedule' as const } }; save(n); void saveToSupabase('ai', n); }}
                  >Schedule</button>
                  <button
                    className={`${styles.segBtn}${settings.aiPrefs.defaultOutput === 'todos' ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => { const n = { ...settings, aiPrefs: { ...settings.aiPrefs, defaultOutput: 'todos' as const } }; save(n); void saveToSupabase('ai', n); }}
                  >Todos</button>
                </div>
              </div>
            </div>

            {savedSection === 'ai' && (
              <p className={styles.savedFlash}>Saved ✓</p>
            )}
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

              <div className={`${styles.integrationRow} ${styles.gcalSection}`}>
                <div className={styles.gcalSectionHeader}>
                  <div className={styles.integrationInfo}>
                    <span className={styles.integrationLabel}>Google Calendar <span className={styles.testingBadge}>Early access</span></span>
                    <span className={styles.integrationDescription}>
                      See your events alongside your schedule — connect up to {gcalLimit} Google account{gcalLimit === 1 ? '' : 's'}
                      {!hasAIAccess(subscription.status) && ` (${GOOGLE_CALENDAR_LIMIT_PREMIUM} for premium)`}
                    </span>
                  </div>
                  <div className={styles.integrationActions}>
                    <button
                      className={styles.connectBtn}
                      onClick={() => void startConnectFlow()}
                      disabled={gcalAtLimit}
                      title={gcalAtLimit ? `You've reached your limit of ${gcalLimit} connected accounts` : undefined}
                    >+ Add Google account</button>
                  </div>
                </div>

                {gcalConnectMsg && <span className={styles.integrationHint}>{gcalConnectMsg}</span>}
                {gcalActionError && <span className={styles.integrationErrorText}>{gcalActionError}</span>}

                {gcalConnections.length > 0 && (
                  <div className={styles.gcalConnectionList}>
                    {gcalConnections.map(connection => (
                      <div key={connection.id} className={styles.gcalConnectionItem}>
                        <div className={styles.gcalConnectionHeader}>
                          <button
                            type="button"
                            className={styles.gcalConnectionToggle}
                            onClick={() => void toggleExpandConnection(connection)}
                          >
                            <span className={styles.gcalConnectionCaret}>{expandedConnectionId === connection.id ? '▾' : '▸'}</span>
                            {connection.googleEmail}
                            <span className={styles.gcalConnectionCount}>
                              {connection.selectedCalendars.length === 0
                                ? 'No calendars synced'
                                : `${connection.selectedCalendars.length} calendar${connection.selectedCalendars.length === 1 ? '' : 's'} synced`}
                            </span>
                          </button>
                          <button className={styles.disconnectBtn} onClick={() => void handleDisconnectGcal(connection)}>Disconnect</button>
                        </div>
                        {expandedConnectionId === connection.id && (
                          <div className={styles.gcalCalendarPicker}>
                            {calendarsLoadingId === connection.id ? (
                              <span className={styles.integrationHint}>Loading calendars…</span>
                            ) : (availableCalendars[connection.id] ?? []).length === 0 ? (
                              <span className={styles.integrationHint}>No calendars found on this account.</span>
                            ) : (
                              (availableCalendars[connection.id] ?? []).map(cal => {
                                const checked = connection.selectedCalendars.some(c => c.id === cal.id);
                                return (
                                  <label key={cal.id} className={styles.gcalCalendarOption}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => void toggleCalendarSelected(connection, cal)}
                                    />
                                    {cal.backgroundColor && (
                                      <span className={styles.gcalCalendarDot} style={{ background: cal.backgroundColor }} />
                                    )}
                                    {cal.summary}{cal.primary ? ' (primary)' : ''}
                                  </label>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.integrationRow}>
                <div className={styles.integrationInfo}>
                  <span className={styles.integrationLabel}>Study material</span>
                  <span className={styles.integrationDescription}>
                    Syllabi, readings, and guides now live on the <a href="/documents">Documents</a> page, organized per subject.
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeSection === 'courses' && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Courses</h2>
            <p className={styles.sectionDescription}>
              Your courses and their colours. Archived courses are hidden from your plan, the AI,
              and Canvas, but your study history in Insights is preserved.
            </p>

            <div className={styles.courseList}>
              {activeSubjects.length === 0 ? (
                <p className={styles.archivedEmpty}>No courses yet. Add one below, or sync them from Canvas.</p>
              ) : activeSubjects.map(s => (
                <div key={s.id} className={styles.courseRow}>
                  <button
                    className={styles.courseDot}
                    style={{ background: s.color }}
                    aria-label={`Change colour for ${s.name}`}
                    onClick={() => setPaletteId(paletteId === s.id ? null : s.id)}
                  />
                  {renamingId === s.id ? (
                    <input
                      className={styles.courseNameInput}
                      autoFocus
                      value={renameDraft}
                      aria-label={`Course name for ${s.name}`}
                      onChange={e => setRenameDraft(e.target.value)}
                      onBlur={() => saveRename(s.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveRename(s.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                    />
                  ) : (
                    <span className={styles.courseName}>{s.name}</span>
                  )}
                  <div className={styles.courseActions}>
                    {s.source === 'canvas' && <span className={styles.courseSource}>Canvas</span>}
                    <button
                      className={styles.restoreBtn}
                      onClick={() => { setRenamingId(s.id); setRenameDraft(s.name); }}
                    >Rename</button>
                    <button
                      className={styles.deleteSubjectBtn}
                      onClick={() => archiveSubject(s.id)}
                    >Archive</button>
                  </div>
                  {paletteId === s.id && (
                    <div className={styles.coursePalette} role="group" aria-label={`Colours for ${s.name}`}>
                      {SUBJECT_COLORS.map(c => (
                        <button
                          key={c}
                          className={`${styles.colorSwatch}${s.color === c ? ` ${styles.colorSwatchSelected}` : ''}`}
                          style={{ background: c }}
                          aria-label={`Colour ${c}`}
                          aria-pressed={s.color === c}
                          onClick={() => recolorSubject(s.id, c)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {addingCourse ? (
              <div className={styles.addCourseForm}>
                <input
                  className={styles.courseNameInput}
                  autoFocus
                  placeholder="Course name"
                  aria-label="New course name"
                  value={newCourseName}
                  onChange={e => { setNewCourseName(e.target.value); setCourseError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') addCourse(); if (e.key === 'Escape') setAddingCourse(false); }}
                />
                <div className={styles.coursePalette} role="group" aria-label="New course colour">
                  {SUBJECT_COLORS.map(c => (
                    <button
                      key={c}
                      className={`${styles.colorSwatch}${newCourseColor === c ? ` ${styles.colorSwatchSelected}` : ''}`}
                      style={{ background: c }}
                      aria-label={`Colour ${c}`}
                      aria-pressed={newCourseColor === c}
                      onClick={() => setNewCourseColor(c)}
                    />
                  ))}
                </div>
                <div className={styles.courseActions}>
                  <button className={styles.restoreBtn} disabled={!newCourseName.trim()} onClick={addCourse}>Add</button>
                  <button className={styles.deleteSubjectBtn} onClick={() => { setAddingCourse(false); setCourseError(''); }}>Cancel</button>
                </div>
                {courseError && <p className={styles.courseError} role="alert">{courseError}</p>}
              </div>
            ) : (
              <button
                className={styles.neutralBtn}
                onClick={() => { setAddingCourse(true); setNewCourseColor(nextUnusedColor(subjects)); }}
              >+ Add a course</button>
            )}

            <div className={styles.endOfSemester}>
              <h3 className={styles.archivedTitle}>End of semester</h3>
              {archiveDone ? (
                <p className={styles.archivedEmpty}>
                  Courses archived. You can restore them below.
                </p>
              ) : (
                <>
                  <p className={styles.archivedEmpty}>
                    Archive every Canvas course at once when the term ends.
                  </p>
                  <button
                    className={styles.neutralBtn}
                    onClick={() => setShowSemesterModal(true)}
                  >
                    Archive current courses
                  </button>
                </>
              )}
            </div>

            <div className={styles.archivedSection}>
              <h3 className={styles.archivedTitle}>Archived Courses</h3>
              {archivedSubjects.length === 0 ? (
                <p className={styles.archivedEmpty}>No archived courses yet.</p>
              ) : (
                <div className={styles.archivedList}>
                  {archivedSubjects.map(s => (
                    <div key={s.id} className={styles.archivedRow}>
                      <span className={styles.archivedDot} style={{ background: s.color }} />
                      <span className={styles.archivedName}>{s.name}</span>
                      <div className={styles.archivedActions}>
                        <button className={styles.restoreBtn} onClick={() => restoreSubject(s.id)}>Restore</button>
                        <button className={styles.deleteSubjectBtn} onClick={() => deleteArchivedSubject(s.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

      </div>
    </div>

    {showSemesterModal && (
      <SemesterEndModal
        onConfirm={archiveCanvasCourses}
        onDismiss={() => setShowSemesterModal(false)}
      />
    )}

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
