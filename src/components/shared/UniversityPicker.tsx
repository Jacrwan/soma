import { useEffect, useId, useRef, useState } from 'react';
import { loadUniversities, searchUniversities, countryName, browserCountry, type Entry, type University } from '../../lib/universities';
import styles from './UniversityPicker.module.css';

type List = Entry[];

const HOME_COUNTRY = browserCountry();

interface Props {
  value: University | null;
  onChange: (value: University | null) => void;
  autoFocus?: boolean;
}

// A search box whose only possible values come from the university list: typing
// filters the dropdown, and nothing is saved until a row is picked.
export default function UniversityPicker({ value, onChange, autoFocus }: Props) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [list, setList] = useState<List | null>(null);
  const [loadError, setLoadError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Follow a value set from outside (e.g. loaded from the profile).
  useEffect(() => { if (value) setQuery(value.name); }, [value]);

  function ensureLoaded() {
    if (list) return;
    setLoadError(false);  // a failed load is retried on the next focus or keystroke
    loadUniversities().then(setList, () => setLoadError(true));
  }

  const typing = !value || query !== value.name;
  const results = list && typing ? searchUniversities(list, query, HOME_COUNTRY) : [];
  const showMenu = open && typing && query.trim().length > 0;

  function pick(u: University) {
    onChange(u);
    setQuery(u.name);
    setOpen(false);
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      setOpen(true);
      setActive(i => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      setActive(i => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && showMenu && results[active]) {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.field}>
        <input
          ref={inputRef}
          className={styles.input}
          role="combobox"
          aria-expanded={showMenu}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showMenu && results[active] ? `${listId}-${active}` : undefined}
          placeholder="Start typing your university"
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onFocus={() => { ensureLoaded(); setOpen(true); }}
          onChange={e => {
            ensureLoaded();
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
            if (value) onChange(null);
          }}
          onBlur={() => {
            setOpen(false);
            // Typed text that wasn't picked from the list is not kept.
            if (!value) setQuery('');
          }}
          onKeyDown={handleKey}
        />
        {value && (
          <button
            type="button"
            className={styles.clear}
            aria-label="Clear university"
            onClick={() => { onChange(null); setQuery(''); inputRef.current?.focus(); }}
          >
            ×
          </button>
        )}
      </div>

      {showMenu && (
        <ul id={listId} role="listbox" className={styles.menu}>
          {loadError ? (
            <li className={styles.note}>Couldn't load the list. Check your connection and try again.</li>
          ) : !list ? (
            <li className={styles.note}>Loading universities…</li>
          ) : results.length === 0 ? (
            <li className={styles.note}>No match. Try the full name, like "University of…"</li>
          ) : results.map((u, i) => (
            <li
              key={`${u.name}|${u.country}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`${styles.option}${i === active ? ` ${styles.optionActive}` : ''}`}
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(u)}
            >
              <span className={styles.optionName}>{u.name}</span>
              <span className={styles.optionCountry}>{countryName(u.country)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
