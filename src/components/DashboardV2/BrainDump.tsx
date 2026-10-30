import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import styles from './BrainDump.module.css';

/**
 * Brain dump: a list for getting everything out of your head, with no AI.
 * Enter adds a line (pasting several lines adds each); + puts that line on
 * the plan in the next open time, as LiveDashboard's `onAdd` decides. The list
 * is kept in this browser only.
 */

type Item = { id: string; text: string };
type Props = { userId: string; onAdd: (text: string) => Promise<string> };

const MAX_ITEMS = 100, MAX_LENGTH = 200;
const read = (key: string): Item[] => { try { const v = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(v) ? v.filter(i => typeof i?.id === 'string' && typeof i?.text === 'string') : []; } catch { return []; } };
const write = (key: string, items: Item[]) => { try { localStorage.setItem(key, JSON.stringify(items)); } catch { /* kept for this visit only */ } };

export default function BrainDump({ userId, onAdd }: Props) {
  const key = `soma_brain_dump:${userId}`;
  const [items, setItems] = useState(() => read(key));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const save = (next: Item[]) => { setItems(next); write(key, next); };
  const take = (lines: string[]) => {
    const fresh = lines.map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim().slice(0, MAX_LENGTH)).filter(Boolean).map(text => ({ id: crypto.randomUUID(), text }));
    if (fresh.length) save([...items, ...fresh].slice(-MAX_ITEMS));
  };

  async function schedule(item: Item) {
    setBusy(item.id); setError(''); setStatus('');
    try {
      const where = await onAdd(item.text);
      save(items.filter(i => i.id !== item.id));
      setStatus(`Added “${item.text}” ${where}.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add it. Please retry.'); }
    finally { setBusy(null); }
  }

  return (
    <section className={styles.dump} aria-labelledby="brain-dump-title">
      <h2 id="brain-dump-title">Brain dump</h2>
      <p className={styles.lead}>Get everything out of your head. Press + to put it on your plan.</p>
      <form onSubmit={e => { e.preventDefault(); take([draft]); setDraft(''); }}>
        <input
          type="text" aria-label="Add to your brain dump" placeholder="Email TA about the lab grade" maxLength={MAX_LENGTH} value={draft}
          onChange={e => setDraft(e.target.value)}
          onPaste={e => { const text = e.clipboardData.getData('text'); if (!/\n/.test(text)) return; e.preventDefault(); take([draft + text.split(/\r?\n/)[0], ...text.split(/\r?\n/).slice(1)]); setDraft(''); }}
        />
      </form>
      {items.length > 0 && <ul>{items.map(item => <li key={item.id}>
        <span>{item.text}</span>
        <button type="button" className={styles.add} disabled={busy !== null} aria-label={`Add “${item.text}” to your plan`} title="Add to your plan" onClick={() => void schedule(item)}><Plus size={15} /></button>
        <button type="button" className={styles.remove} disabled={busy !== null} aria-label={`Remove “${item.text}”`} title="Remove" onClick={() => save(items.filter(i => i.id !== item.id))}><X size={14} /></button>
      </li>)}</ul>}
      {busy && <p className={styles.note}>Finding a time…</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {status && !busy && <p role="status" className={styles.note}>{status}</p>}
    </section>
  );
}
