import { useState, useEffect } from 'react';
import { storage, SomaSettings } from '../../lib/storage';
import { resetTimeAccuracy, resetPeakHours, resetSubjectPacing } from '../../lib/insights';
import { supabase } from '../../lib/supabase';
import styles from './SettingsTab.module.css';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
type Day = typeof DAYS[number];
type HoursCategory = 'schoolHours' | 'workHours' | 'personalHours';
type Section = 'availability' | 'study' | 'ai' | 'memory' | 'integrations';

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function SettingsTab() {
  const [settings, setSettings] = useState<SomaSettings>(() => storage.getSomaSettings());
  const [activeSection, setActiveSection] = useState<Section>('availability');

  // Canvas integration state
  const [canvasToken, setCanvasToken] = useState(() => storage.getCanvasToken());
  const [canvasBaseUrl, setCanvasBaseUrl] = useState(() => storage.getCanvasBaseUrl());
  const [showCanvasModal, setShowCanvasModal] = useState(false);
  const [canvasUrlInput, setCanvasUrlInput] = useState('');
  const [canvasTokenInput, setCanvasTokenInput] = useState('');
  const [canvasConnecting, setCanvasConnecting] = useState(false);
  const [canvasError, setCanvasError] = useState('');

  // Google Calendar integration state
  const [gcalToken, setGcalToken] = useState(() => storage.getGoogleToken());

  // On mount (and after OAuth redirect back), pull provider_token from session
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const pt = data.session?.provider_token;
      if (pt) {
        storage.setGoogleToken(pt);
        setGcalToken(pt);
      }
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

  async function connectCanvas() {
    const url = canvasUrlInput.trim().replace(/\/$/, '');
    const tk = canvasTokenInput.trim();
    if (!url || !tk) return;
    setCanvasConnecting(true);
    setCanvasError('');
    try {
      const base = import.meta.env.DEV ? '/canvas-api' : url;
      const res = await fetch(`${base}/api/v1/courses?per_page=1`, {
        headers: { Authorization: `Bearer ${tk}` },
      });
      if (!res.ok) throw new Error('bad');
      storage.setCanvasToken(tk);
      storage.setCanvasBaseUrl(url);
      setCanvasToken(tk);
      setCanvasBaseUrl(url);
      setShowCanvasModal(false);
      setCanvasUrlInput('');
      setCanvasTokenInput('');
    } catch {
      setCanvasError('Invalid token or URL.');
    } finally {
      setCanvasConnecting(false);
    }
  }

  function disconnectCanvas() {
    storage.setCanvasToken('');
    storage.setCanvasBaseUrl('');
    setCanvasToken('');
    setCanvasBaseUrl('');
  }

  async function connectGcal() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/calendar.readonly',
        redirectTo: window.location.href,
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

  const navItems: [Section, string][] = [
    ['availability', 'Availability'],
    ['study', 'Study Preferences'],
    ['ai', 'AI Behavior'],
    ['memory', 'AI Memory'],
    ['integrations', 'Integrations'],
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

        {activeSection === 'memory' && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>AI Memory</h2>
            <div className={styles.prefGrid}>
              <div className={styles.prefRow}>
                <label className={styles.prefLabel}>Enable AI learning</label>
                <div className={styles.segment}>
                  <button
                    className={`${styles.segBtn}${settings.aiMemory.enabled ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => save({ ...settings, aiMemory: { enabled: true } })}
                  >On</button>
                  <button
                    className={`${styles.segBtn}${!settings.aiMemory.enabled ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => save({ ...settings, aiMemory: { enabled: false } })}
                  >Off</button>
                </div>
              </div>

              <div className={styles.resetGroup}>
                <span className={styles.resetGroupLabel}>Reset stored data</span>
                <div className={styles.resetBtns}>
                  <button
                    className={styles.resetBtn}
                    onClick={() => { if (window.confirm('Reset time accuracy data? This cannot be undone.')) resetTimeAccuracy(); }}
                  >Time accuracy</button>
                  <button
                    className={styles.resetBtn}
                    onClick={() => { if (window.confirm('Reset peak hours data? This cannot be undone.')) resetPeakHours(); }}
                  >Peak hours</button>
                  <button
                    className={styles.resetBtn}
                    onClick={() => { if (window.confirm('Reset subject pacing data? This cannot be undone.')) resetSubjectPacing(); }}
                  >Subject pacing</button>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeSection === 'integrations' && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Integrations</h2>
            <div className={styles.integrationList}>

              <div className={styles.integrationRow}>
                <div className={styles.integrationInfo}>
                  <span className={styles.integrationLabel}>Canvas LMS</span>
                  <span className={styles.integrationDescription}>Sync your assignments and due dates</span>
                </div>
                <div className={styles.integrationActions}>
                  {canvasToken && canvasBaseUrl ? (
                    <>
                      <span className={styles.connectedBadge}>Connected</span>
                      <button className={styles.disconnectBtn} onClick={disconnectCanvas}>Disconnect</button>
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

            </div>
          </section>
        )}

      </div>
    </div>

    {/* Canvas connect modal */}
    {showCanvasModal && (
      <div className={styles.modalOverlay} onClick={() => setShowCanvasModal(false)}>
        <div className={styles.modalBox} onClick={e => e.stopPropagation()}>
          <span className={styles.modalTitle}>Connect Canvas LMS</span>
          <div className={styles.modalField}>
            <label className={styles.modalLabel}>Canvas URL</label>
            <input
              className={styles.modalInput}
              placeholder="https://school.instructure.com"
              value={canvasUrlInput}
              autoFocus
              onChange={e => setCanvasUrlInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') connectCanvas(); if (e.key === 'Escape') setShowCanvasModal(false); }}
            />
          </div>
          <div className={styles.modalField}>
            <label className={styles.modalLabel}>Access token</label>
            <input
              className={styles.modalInput}
              placeholder="Paste your token"
              value={canvasTokenInput}
              onChange={e => setCanvasTokenInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') connectCanvas(); if (e.key === 'Escape') setShowCanvasModal(false); }}
            />
          </div>
          {canvasError && <span className={styles.modalError}>{canvasError}</span>}
          <div className={styles.modalHint}>
            In Canvas: Account → Settings → Approved Integrations → New Access Token
          </div>
          <div className={styles.modalActions}>
            <button
              className={styles.modalSubmit}
              onClick={connectCanvas}
              disabled={canvasConnecting || !canvasUrlInput.trim() || !canvasTokenInput.trim()}
            >{canvasConnecting ? 'Connecting…' : 'Connect'}</button>
            <button className={styles.modalCancel} onClick={() => setShowCanvasModal(false)}>Cancel</button>
          </div>
        </div>
      </div>
    )}

</>
  );
}
