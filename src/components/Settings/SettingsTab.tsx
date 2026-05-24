import { useState } from 'react';
import { storage, SomaSettings } from '../../lib/storage';
import { resetTimeAccuracy, resetPeakHours, resetSubjectPacing } from '../../lib/insights';
import styles from './SettingsTab.module.css';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
type Day = typeof DAYS[number];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function SettingsTab() {
  const [settings, setSettings] = useState<SomaSettings>(() => storage.getSomaSettings());

  function save(next: SomaSettings) {
    setSettings(next);
    storage.setSomaSettings(next);
  }

  function setDayField(day: Day, field: 'start' | 'end', value: string) {
    save({
      ...settings,
      availability: {
        ...settings.availability,
        [day]: { ...settings.availability[day], [field]: value },
      },
    });
  }

  function addBlocked(day: Day) {
    const prev = settings.availability[day];
    save({
      ...settings,
      availability: {
        ...settings.availability,
        [day]: { ...prev, blocked: [...prev.blocked, { start: '15:00', end: '16:00' }] },
      },
    });
  }

  function setBlocked(day: Day, index: number, field: 'start' | 'end', value: string) {
    const prev = settings.availability[day];
    const blocked = prev.blocked.map((b, i) => i === index ? { ...b, [field]: value } : b);
    save({
      ...settings,
      availability: { ...settings.availability, [day]: { ...prev, blocked } },
    });
  }

  function removeBlocked(day: Day, index: number) {
    const prev = settings.availability[day];
    save({
      ...settings,
      availability: {
        ...settings.availability,
        [day]: { ...prev, blocked: prev.blocked.filter((_, i) => i !== index) },
      },
    });
  }

  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Availability</h2>
        <div className={styles.availabilityList}>
          {DAYS.map(day => {
            const avail = settings.availability[day];
            return (
              <div key={day} className={styles.dayRow}>
                <div className={styles.dayHeader}>
                  <span className={styles.dayLabel}>{capitalize(day)}</span>
                  <div className={styles.timeRange}>
                    <input
                      type="time"
                      className={styles.timeInput}
                      value={avail.start}
                      onChange={e => setDayField(day, 'start', e.target.value)}
                    />
                    <span className={styles.timeSep}>to</span>
                    <input
                      type="time"
                      className={styles.timeInput}
                      value={avail.end}
                      onChange={e => setDayField(day, 'end', e.target.value)}
                    />
                    <button
                      className={styles.addBlockedBtn}
                      onClick={() => addBlocked(day)}
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
                          onChange={e => setBlocked(day, i, 'start', e.target.value)}
                        />
                        <span className={styles.tagDash}>–</span>
                        <input
                          type="time"
                          className={styles.tagTime}
                          value={block.end}
                          onChange={e => setBlocked(day, i, 'end', e.target.value)}
                        />
                        <button
                          className={styles.tagRemove}
                          onClick={() => removeBlocked(day, i)}
                          title="Remove"
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

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

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Integrations</h2>
      </section>
    </div>
  );
}
