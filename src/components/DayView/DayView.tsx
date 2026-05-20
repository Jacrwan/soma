import { useState, useEffect, useRef } from 'react';
import { storage } from '../../lib/storage';
import { Subject, TimeBlock, SubjectColor, Todo } from '../../types';
import SubjectDot from '../shared/SubjectDot';
import TimerOverlay from '../Timer/TimerOverlay';
import styles from './DayView.module.css';

const SLOT_HEIGHT = 40;
const START_HOUR = 6;
const END_HOUR = 24;
const TOTAL_SLOTS = (END_HOUR - START_HOUR) * 2;
const COLORS: SubjectColor[] = [
  '#ef5350', '#42a5f5', '#66bb6a', '#ab47bc',
  '#ffa726', '#26c6da', '#ec407a', '#8d6e63',
];

function minToTop(minutes: number) {
  return ((minutes - START_HOUR * 60) / 30) * SLOT_HEIGHT;
}

function durToHeight(minutes: number) {
  return (minutes / 30) * SLOT_HEIGHT;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtSecs(s: number) {
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

function isToday(iso: string) {
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear()
    && d.getMonth() === n.getMonth()
    && d.getDate() === n.getDate();
}

interface AddBlockForm {
  slotMinutes: number;
  subjectId: string;
  task: string;
  durationMinutes: number;
}

interface PopoverState {
  block: TimeBlock;
  subject: Subject | undefined;
}

interface SubjectEditState {
  id: string;
  name: string;
  color: SubjectColor;
}

interface AddSubjectForm {
  name: string;
  color: SubjectColor;
}

export default function DayView() {
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [currentMinutes, setCurrentMinutes] = useState(0);
  const [addForm, setAddForm] = useState<AddBlockForm | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [timerSubject, setTimerSubject] = useState<Subject | null>(null);
  const [showAddSubject, setShowAddSubject] = useState(false);
  const [todos, setTodos] = useState<Todo[]>(() => storage.getTodos());
  const [addSubjectForm, setAddSubjectForm] = useState<AddSubjectForm>({ name: '', color: COLORS[0] });
  const [editSubject, setEditSubject] = useState<SubjectEditState | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBlocks(storage.getTimeBlocks().filter(b => isToday(b.startTime)));
    setSubjects(storage.getSubjects());

    const tick = () => {
      const now = new Date();
      setCurrentMinutes(now.getHours() * 60 + now.getMinutes());
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!popover) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [popover]);

  const slots = Array.from({ length: TOTAL_SLOTS }, (_, i) => {
    const minutes = START_HOUR * 60 + i * 30;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return { minutes, label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
  });

  const showCurrentTime = currentMinutes >= START_HOUR * 60 && currentMinutes < END_HOUR * 60;

  function openAddForm(slotMinutes: number) {
    setPopover(null);
    setAddForm({
      slotMinutes,
      subjectId: subjects[0]?.id ?? '',
      task: '',
      durationMinutes: 60,
    });
  }

  function saveBlock() {
    if (!addForm) return;
    const subject = subjects.find(s => s.id === addForm.subjectId);
    if (!subject) return;
    const now = new Date();
    const start = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(),
      Math.floor(addForm.slotMinutes / 60), addForm.slotMinutes % 60,
    );
    const end = new Date(start.getTime() + addForm.durationMinutes * 60_000);
    const block: TimeBlock = {
      id: crypto.randomUUID(),
      subjectId: addForm.subjectId,
      task: addForm.task,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      source: 'manual',
    };
    const all = [...storage.getTimeBlocks(), block];
    storage.setTimeBlocks(all);
    setBlocks(prev => [...prev, block]);
    setAddForm(null);
  }

  function deleteBlock(id: string) {
    storage.setTimeBlocks(storage.getTimeBlocks().filter(b => b.id !== id));
    setBlocks(prev => prev.filter(b => b.id !== id));
    setPopover(null);
  }

  function saveNewSubject() {
    if (!addSubjectForm.name.trim()) return;
    const s: Subject = {
      id: crypto.randomUUID(),
      name: addSubjectForm.name.trim(),
      color: addSubjectForm.color,
      totalTimeToday: 0,
    };
    const updated = [...subjects, s];
    storage.setSubjects(updated);
    setSubjects(updated);
    setShowAddSubject(false);
    setAddSubjectForm({ name: '', color: COLORS[0] });
  }

  function saveEditSubject() {
    if (!editSubject) return;
    const updated = subjects.map(s =>
      s.id === editSubject.id ? { ...s, name: editSubject.name, color: editSubject.color } : s,
    );
    storage.setSubjects(updated);
    setSubjects(updated);
    setEditSubject(null);
  }

  function deleteSubject(id: string) {
    const updated = subjects.filter(s => s.id !== id);
    storage.setSubjects(updated);
    setSubjects(updated);
    setEditSubject(null);
  }

  function handleSessionSaved(updatedSubjects: Subject[], updatedBlocks: TimeBlock[]) {
    setSubjects(updatedSubjects);
    setBlocks(updatedBlocks);
  }

  function handleLiveBlockUpdate(block: TimeBlock) {
    setBlocks(prev => prev.map(b => b.id === block.id ? block : b));
  }

  function toggleTodo(id: string) {
    const updated = todos.map(t => t.id === id ? { ...t, done: !t.done } : t);
    storage.setTodos(updated);
    setTodos(updated);
  }

  const gridHeight = TOTAL_SLOTS * SLOT_HEIGHT;

  return (
    <div className={styles.container}>
      {/* ── Left panel ── */}
      <div className={styles.left}>
        <div className={styles.gridWrapper} style={{ height: gridHeight }}>

          {slots.map(slot => (
            <div
              key={slot.minutes}
              className={styles.slot}
              style={{ top: minToTop(slot.minutes), height: SLOT_HEIGHT }}
            >
              <span className={styles.timeLabel}>{slot.label}</span>
              <div className={styles.slotArea} onClick={() => openAddForm(slot.minutes)} />
            </div>
          ))}

          {showCurrentTime && (
            <div className={styles.currentTimeLine} style={{ top: minToTop(currentMinutes) }} />
          )}

          {blocks.map(block => {
            const subject = subjects.find(s => s.id === block.subjectId);
            const start = new Date(block.startTime);
            const end = new Date(block.endTime);
            const startMin = start.getHours() * 60 + start.getMinutes();
            const durMin = (end.getTime() - start.getTime()) / 60_000;
            return (
              <div
                key={block.id}
                className={styles.block}
                style={{
                  top: minToTop(startMin),
                  height: durToHeight(durMin),
                  borderLeftColor: subject?.color ?? '#ccc',
                  backgroundColor: subject ? `${subject.color}1f` : '#f5f5f5',
                }}
                onClick={e => {
                  e.stopPropagation();
                  setAddForm(null);
                  setPopover({ block, subject });
                }}
              >
                <span className={styles.blockSubject}>{subject?.name}</span>
                <span className={styles.blockTask}>{block.task}</span>
              </div>
            );
          })}

          {addForm && (
            <div
              className={styles.addForm}
              style={{ top: minToTop(addForm.slotMinutes) }}
              onClick={e => e.stopPropagation()}
            >
              <select
                value={addForm.subjectId}
                onChange={e => setAddForm(f => f && { ...f, subjectId: e.target.value })}
              >
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input
                placeholder="Task"
                value={addForm.task}
                autoFocus
                onChange={e => setAddForm(f => f && { ...f, task: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') saveBlock(); if (e.key === 'Escape') setAddForm(null); }}
              />
              <select
                value={addForm.durationMinutes}
                onChange={e => setAddForm(f => f && { ...f, durationMinutes: Number(e.target.value) })}
              >
                <option value={30}>30 min</option>
                <option value={60}>1 hour</option>
                <option value={90}>1.5 hours</option>
                <option value={120}>2 hours</option>
              </select>
              <div className={styles.btnRow}>
                <button className={`${styles.btn} ${styles.btnAccent}`} onClick={saveBlock}>Save</button>
                <button className={styles.btn} onClick={() => setAddForm(null)}>Cancel</button>
              </div>
            </div>
          )}

          {popover && (
            <div
              ref={popoverRef}
              className={styles.popover}
              style={{ top: minToTop(new Date(popover.block.startTime).getHours() * 60 + new Date(popover.block.startTime).getMinutes()) }}
            >
              <div className={styles.popoverHeader}>
                <SubjectDot color={popover.subject?.color ?? '#ccc'} size={12} />
                <span>{popover.subject?.name ?? 'Unknown'}</span>
              </div>
              {popover.block.task && <div className={styles.popoverTask}>{popover.block.task}</div>}
              <div className={styles.popoverTime}>
                {fmtTime(popover.block.startTime)} – {fmtTime(popover.block.endTime)}
              </div>
              <button
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => deleteBlock(popover.block.id)}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className={styles.right}>
        <div className={styles.subjectHeader}>
          <span className={styles.subjectHeaderTitle}>Subjects</span>
          <button
            className={styles.addSubjectBtn}
            onClick={() => { setShowAddSubject(true); setEditSubject(null); }}
          >+</button>
        </div>

        {subjects.map(subject => (
          <div
            key={subject.id}
            className={`${styles.subjectRow}${timerSubject?.id === subject.id ? ` ${styles.highlighted}` : ''}`}
            onClick={() => {
              if (editSubject?.id === subject.id) return;
              setTimerSubject(subject);
            }}
          >
            {editSubject?.id === subject.id ? (
              <div className={styles.editSubjectForm} onClick={e => e.stopPropagation()}>
                <input
                  value={editSubject.name}
                  autoFocus
                  onChange={e => setEditSubject(s => s && { ...s, name: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') saveEditSubject(); if (e.key === 'Escape') setEditSubject(null); }}
                />
                <div className={styles.colorPicker}>
                  {COLORS.map(c => (
                    <button
                      key={c}
                      className={`${styles.colorCircle}${editSubject.color === c ? ` ${styles.colorCircleSelected}` : ''}`}
                      style={{ background: c }}
                      onClick={() => setEditSubject(s => s && { ...s, color: c })}
                    />
                  ))}
                </div>
                <div className={styles.btnRow}>
                  <button className={`${styles.btn} ${styles.btnAccent}`} onClick={saveEditSubject}>Save</button>
                  <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => deleteSubject(subject.id)}>Delete</button>
                  <button className={styles.btn} onClick={() => setEditSubject(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <SubjectDot color={subject.color} size={12} />
                <span className={styles.subjectName}>{subject.name}</span>
                <span className={styles.subjectTime}>{fmtSecs(subject.totalTimeToday)}</span>
                <button
                  className={styles.editIcon}
                  onClick={e => {
                    e.stopPropagation();
                    setEditSubject({ id: subject.id, name: subject.name, color: subject.color });
                  }}
                >✎</button>
              </>
            )}
          </div>
        ))}

        {todos.length > 0 && (
          <>
            <div className={styles.todosHeader}>Todos</div>
            {todos.map(todo => (
              <div
                key={todo.id}
                className={`${styles.todoRow}${todo.done ? ` ${styles.todoDone}` : ''}`}
                onClick={() => toggleTodo(todo.id)}
              >
                <span className={styles.todoCheck}>{todo.done ? '✓' : '○'}</span>
                <span className={styles.todoText}>{todo.text}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ── Timer Overlay ── */}
      {timerSubject && (
        <TimerOverlay
          subject={timerSubject}
          onClose={() => setTimerSubject(null)}
          onSessionSaved={handleSessionSaved}
          onLiveBlockUpdate={handleLiveBlockUpdate}
        />
      )}

      {/* ── Add Subject Modal ── */}
      {showAddSubject && (
        <div className={styles.modalOverlay} onClick={() => setShowAddSubject(false)}>
          <div className={styles.modalBox} onClick={e => e.stopPropagation()}>
            <span className={styles.modalTitle}>Add Subject</span>
            <input
              className={styles.modalInput}
              placeholder="Subject name"
              value={addSubjectForm.name}
              autoFocus
              onChange={e => setAddSubjectForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') saveNewSubject(); if (e.key === 'Escape') setShowAddSubject(false); }}
            />
            <div className={styles.colorPicker}>
              {COLORS.map(c => (
                <button
                  key={c}
                  className={`${styles.colorCircle}${addSubjectForm.color === c ? ` ${styles.colorCircleSelected}` : ''}`}
                  style={{ background: c }}
                  onClick={() => setAddSubjectForm(f => ({ ...f, color: c }))}
                />
              ))}
            </div>
            <div className={styles.modalActions}>
              <button
                className={`${styles.btn} ${styles.btnAccent}`}
                onClick={saveNewSubject}
                disabled={!addSubjectForm.name.trim()}
              >Save</button>
              <button className={styles.btn} onClick={() => setShowAddSubject(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
