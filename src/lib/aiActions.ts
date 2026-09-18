import type { SubjectColor, Todo, AiTodo } from '../types';
export type AIActionStore=Pick<typeof import('./storage').storage,'getSubjects'|'fetchSubjects'|'saveSubject'|'deleteSubject'|'getTodos'|'fetchAllTodos'|'saveTodo'|'deleteTodo'|'saveTodoSession'|'deleteTodoSession'|'updateTodoSession'|'fetchTodoSessionsByTodoId'|'fetchTodoSessionById'>;
const notify=(name:string)=>{if(typeof window!=='undefined')window.dispatchEvent(new Event(name));};
const getTodayKey=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;}
function validateSession(session:{date:string;start_time:string;end_time:string}){
 if(!validDate(session.date) || !/^\d{4}-\d{2}-\d{2}T/.test(session.start_time) || !/^\d{4}-\d{2}-\d{2}T/.test(session.end_time))throw new Error('Invalid session date. Nothing was saved.');
 const start=Date.parse(session.start_time),end=Date.parse(session.end_time);
 if(!Number.isFinite(start) || !Number.isFinite(end) || end<=start || end-start>86400000 || `${new Date(start).getFullYear()}-${String(new Date(start).getMonth()+1).padStart(2,'0')}-${String(new Date(start).getDate()).padStart(2,'0')}`!==session.date)throw new Error('Invalid session times. Nothing was saved.');
}
function validateAction(action:SomaAction){
 if('title' in action && action.title && action.title.length>500)throw new Error('Task title is too long.');
 if('due_date' in action && action.due_date && !validDate(action.due_date))throw new Error('Invalid due date. Nothing was saved.');
 if(action.action==='create_todo')for(const session of action.sessions??[])validateSession(session);
 if(action.action==='create_session')validateSession(action);
}
const SUBJECT_COLORS: SubjectColor[] = ['#ef5350','#42a5f5','#66bb6a','#ab47bc','#ffa726','#26c6da','#ec407a','#8d6e63'];

export type SomaAction =
  | { action: 'create_subject'; name: string; color: SubjectColor }
  | { action: 'update_subject'; subject_id: string; name?: string; color?: SubjectColor }
  | { action: 'archive_subject'; subject_id: string }
  | { action: 'delete_subject'; subject_id: string }
  | { action: 'create_todo'; title: string; subject_id?: string; due_date?: string; sessions?: Array<{ date: string; start_time: string; end_time: string }> }
  | { action: 'update_todo'; todo_id: string; title?: string; due_date?: string; notes?: string }
  | { action: 'complete_todo'; todo_id: string }
  | { action: 'delete_todo'; todo_id: string }
  | { action: 'create_session'; todo_id: string; date: string; start_time: string; end_time: string }
  | { action: 'delete_session'; session_id: string }
  | { action: 'update_session'; session_id: string; start_time?: string; end_time?: string };

function parseSingleSomaAction(json: string): SomaAction | null {
  try {
    const p = JSON.parse(json.trim());
    if (p.action === 'create_subject' && typeof p.name === 'string' && p.name.trim()) {
      const color: SubjectColor = SUBJECT_COLORS.includes(p.color) ? p.color : '#42a5f5';
      return { action: 'create_subject', name: p.name.trim(), color };
    }
    if (p.action === 'update_subject' && typeof p.subject_id === 'string')
      return {
        action: 'update_subject',
        subject_id: p.subject_id,
        name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : undefined,
        color: SUBJECT_COLORS.includes(p.color) ? p.color : undefined,
      };
    if (p.action === 'archive_subject' && typeof p.subject_id === 'string')
      return { action: 'archive_subject', subject_id: p.subject_id };
    if (p.action === 'delete_subject' && typeof p.subject_id === 'string')
      return { action: 'delete_subject', subject_id: p.subject_id };
    if(p.action==='create_todo' && p.sessions!==undefined && (!Array.isArray(p.sessions) || p.sessions.length>25 || p.sessions.some((v:unknown)=>!v || typeof v!=='object' || !['date','start_time','end_time'].every(k=>typeof (v as Record<string,unknown>)[k]==='string'))))return null;
    if (p.action === 'create_todo' && typeof p.title === 'string' && p.title.trim())
      return {
        action: 'create_todo',
        title: p.title.trim(),
        subject_id: typeof p.subject_id === 'string' ? p.subject_id : undefined,
        due_date: typeof p.due_date === 'string' ? p.due_date : undefined,
        sessions: Array.isArray(p.sessions)
          ? (p.sessions as unknown[])
              .filter((s): s is Record<string, string> =>
                typeof s === 'object' && s !== null &&
                typeof (s as Record<string, unknown>).date === 'string' &&
                typeof (s as Record<string, unknown>).start_time === 'string' &&
                typeof (s as Record<string, unknown>).end_time === 'string',
              )
              .map(s => ({ date: s.date, start_time: s.start_time, end_time: s.end_time }))
          : undefined,
      };
    if (p.action === 'update_todo' && typeof p.todo_id === 'string')
      return {
        action: 'update_todo',
        todo_id: p.todo_id,
        title: typeof p.title === 'string' && p.title.trim() ? p.title.trim() : undefined,
        due_date: typeof p.due_date === 'string' ? p.due_date : undefined,
        notes: typeof p.notes === 'string' ? p.notes : undefined,
      };
    if (p.action === 'complete_todo' && typeof p.todo_id === 'string')
      return { action: 'complete_todo', todo_id: p.todo_id };
    if (p.action === 'delete_todo' && typeof p.todo_id === 'string')
      return { action: 'delete_todo', todo_id: p.todo_id };
    if (p.action === 'create_session' &&
        typeof p.todo_id === 'string' &&
        typeof p.date === 'string' &&
        typeof p.start_time === 'string' &&
        typeof p.end_time === 'string')
      return { action: 'create_session', todo_id: p.todo_id, date: p.date, start_time: p.start_time, end_time: p.end_time };
    if (p.action === 'delete_session' && typeof p.session_id === 'string')
      return { action: 'delete_session', session_id: p.session_id };
    if (p.action === 'update_session' && typeof p.session_id === 'string')
      return {
        action: 'update_session',
        session_id: p.session_id,
        start_time: typeof p.start_time === 'string' ? p.start_time : undefined,
        end_time: typeof p.end_time === 'string' ? p.end_time : undefined,
      };
    return null;
  } catch { return null; }
}

export function parseSomaActions(content: string): SomaAction[] {
  const actions: SomaAction[] = [];
  let m: RegExpExecArray | null;

  // Primary: <soma-action>JSON</soma-action> (may appear multiple times)
  const primary = /<soma-action>([\s\S]*?)<\/soma-action>/g;
  while ((m = primary.exec(content)) !== null) {
    const action = parseSingleSomaAction(m[1]);
    if (!action) throw new Error('Soma returned an invalid action. Nothing was applied.');
    actions.push(action);
  }
  if (actions.length > 0) return actions;


  return actions;
}

export async function executeSomaAction(action: SomaAction, storage: AIActionStore, validateSchedule?: ScheduleValidator): Promise<string | null> {
  validateAction(action);
  switch (action.action) {
    case 'create_subject': {
      const existing = storage.getSubjects();
      if (!existing.some(s => s.name.toLowerCase() === action.name.toLowerCase())) {
        await storage.saveSubject({
          id: crypto.randomUUID(), name: action.name, color: action.color,
          totalTimeToday: 0, source: 'manual' as const,
        });
        await storage.fetchSubjects();
      }
      notify('soma_subjects_changed');
      return `✓ Created subject: "${action.name}"`;
    }
    case 'update_subject': {
      const subj = storage.getSubjects().find(s => s.id === action.subject_id);
      if (!subj) throw new Error('Subject no longer exists. Refresh and try again.');
      const updated = {
        ...subj,
        ...(action.name ? { name: action.name } : {}),
        ...(action.color ? { color: action.color } : {}),
      };
      await storage.saveSubject(updated);
      await storage.fetchSubjects();
      notify('soma_subjects_changed');
      return `✓ Updated subject: "${updated.name}"`;
    }
    case 'archive_subject': {
      const subj = storage.getSubjects().find(s => s.id === action.subject_id);
      if (!subj) throw new Error('Subject no longer exists. Refresh and try again.');
      await storage.saveSubject({ ...subj, archived: true });
      await storage.fetchSubjects();
      notify('soma_subjects_changed');
      return `✓ Archived: ${subj.name}`;
    }
    case 'delete_subject': {
      const subj = storage.getSubjects().find(s => s.id === action.subject_id);
      if (!subj) throw new Error('Subject no longer exists. Refresh and try again.');
      await storage.deleteSubject(action.subject_id);
      await storage.fetchSubjects();
      notify('soma_subjects_changed');
      return `✓ Deleted subject: "${subj.name}"`;
    }
    case 'create_todo': {
      // Validate subject_id — reject silently-wrong assignments
      let resolvedSubjectId: string | undefined = undefined;
      if (action.subject_id) {
        const exists = storage.getSubjects().some(s => s.id === action.subject_id && !s.archived);
        if (exists) {
          resolvedSubjectId = action.subject_id;
        } else {
          throw new Error('The selected subject no longer exists or is archived. No task was created.');
        }
      }
      const totalSessionMins = Array.isArray(action.sessions) && action.sessions.length > 0
        ? action.sessions.reduce((sum, sess) => {
            const s = new Date(sess.start_time).getTime();
            const e = new Date(sess.end_time).getTime();
            return sum + Math.round((e - s) / 60_000);
          }, 0)
        : 0;

      // Dedup: if a non-done todo with the same title + subject already exists, reuse it.
      const existingTodo = storage.getTodos().find(t =>
        t.text.trim().toLowerCase() === action.title.trim().toLowerCase() &&
        t.subjectId === resolvedSubjectId &&
        t.status !== 'done',
      );

      let todoId: string;
      if (existingTodo) {
        todoId = existingTodo.id;
      } else {
        const newTodo: Todo = {
          id: crypto.randomUUID(),
          text: action.title,
          status: 'nothing',
          subjectId: resolvedSubjectId,
          dueDate: action.due_date,
          date: action.due_date ?? getTodayKey(),
          estimatedMinutes: totalSessionMins > 0 ? totalSessionMins : undefined,
        };
        todoId = newTodo.id;
        await storage.saveTodo(newTodo);
        await storage.fetchAllTodos();
        notify('soma_todos_changed');
      }

      if (action.sessions && action.sessions.length > 0) {
        const saved: string[]=[];
        try {
          const current=await storage.fetchTodoSessionsByTodoId(todoId);
          for(const sess of action.sessions){
            if(current.some(s=>s.startTime && s.endTime && +new Date(s.startTime)===+new Date(sess.start_time) && +new Date(s.endTime)===+new Date(sess.end_time)))continue;
            if(validateSchedule)await validateSchedule(sess);
            const id=await storage.saveTodoSession({todoId,date:sess.date,startTime:sess.start_time,endTime:sess.end_time});
            saved.push(id);
            current.push({id,todoId,date:sess.date,startTime:sess.start_time,endTime:sess.end_time});
          }
        } catch {
          try {for(const id of saved)await storage.deleteTodoSession(id);if(!existingTodo)await storage.deleteTodo(todoId);await storage.fetchAllTodos();}
          catch {throw new Error('Scheduling failed and cleanup was incomplete. Check your task and calendar before retrying.');}
          throw new Error('Scheduling failed. The new task/session changes were rolled back; please retry.');
        }
        notify('soma_todo_sessions_changed');
      }
      const subjectNote = action.subject_id && !resolvedSubjectId ? ' (subject not found — left unassigned)' : '';
      const dedupNote = existingTodo ? ' (existing todo reused)' : '';
      return `✓ Added todo: "${action.title}"${subjectNote}${dedupNote}`;
    }
    case 'update_todo': {
      const todo = storage.getTodos().find(t => t.id === action.todo_id);
      if (!todo) throw new Error('Task no longer exists. Refresh and try again.');
      const updated: Todo = {
        ...todo,
        ...(action.title ? { text: action.title } : {}),
        ...(action.due_date !== undefined ? { dueDate: action.due_date || undefined } : {}),
        ...(action.notes !== undefined ? { notes: action.notes || undefined } : {}),
      };
      await storage.saveTodo(updated);
      await storage.fetchAllTodos();
      notify('soma_todos_changed');
      return `✓ Updated todo: "${updated.text}"`;
    }
    case 'complete_todo': {
      const todo = storage.getTodos().find(t => t.id === action.todo_id);
      if (!todo) throw new Error('Task no longer exists. Refresh and try again.');
      await storage.saveTodo({...todo,status:'done'});
      await storage.fetchAllTodos();
      notify('soma_todos_changed');
      return `✓ Completed: "${todo.text}"`;
    }
    case 'delete_todo': {
      const allTodos = storage.getTodos();
      const todo = allTodos.find(t => t.id === action.todo_id);
      if(!todo)throw new Error('Task no longer exists. Nothing was deleted.');
      await storage.deleteTodo(action.todo_id);
      await storage.fetchAllTodos();
      notify('soma_todos_changed');
      return todo ? `✓ Deleted todo: "${todo.text}"` : '✓ Todo deleted';
    }
    case 'create_session': {
      const todo = storage.getTodos().find(t => t.id === action.todo_id);
      if (!todo) return `✗ Todo not found for session: ${action.todo_id}`;
      if(validateSchedule)await validateSchedule(action);
      await storage.saveTodoSession({
        todoId: action.todo_id,
        date: action.date,
        startTime: action.start_time,
        endTime: action.end_time,
      });
      notify('soma_todo_sessions_changed');
      return `✓ Scheduled session for "${todo.text}"`;
    }
    case 'delete_session': {
      await storage.fetchTodoSessionById(action.session_id);
      await storage.deleteTodoSession(action.session_id);
      notify('soma_todo_sessions_changed');
      return `✓ Deleted session`;
    }
    case 'update_session': {
      const previous=await storage.fetchTodoSessionById(action.session_id);
      const start=action.start_time??previous.startTime,end=action.end_time??previous.endTime;
      if(!start || !end)throw new Error('Start and end times are required.');
      const d=new Date(start);
      const session={date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,start_time:start,end_time:end};
      validateSession(session);
      if(validateSchedule)await validateSchedule(session,action.session_id);
      await storage.updateTodoSession(action.session_id, {
        startTime: action.start_time,
        endTime: action.end_time,
      });
      notify('soma_todo_sessions_changed');
      return `✓ Updated session`;
    }
  }
}


export type ScheduleValidator=(session:{date:string;start_time:string;end_time:string},excludeSessionId?:string)=>Promise<void>;
export async function executeSomaActions(actions:SomaAction[],storage:AIActionStore,validateSchedule?:ScheduleValidator,assertUser?:()=>Promise<void>):Promise<string[]>{
 if(actions.length>25)throw new Error('Too many changes in one reply. Ask for a smaller plan.');
 actions.forEach(validateAction);
 await Promise.all([storage.fetchAllTodos(),storage.fetchSubjects()]);
 const results:string[]=[];
 for(let i=0;i<actions.length;i++){
  try{if(assertUser)await assertUser();const result=await executeSomaAction(actions[i],storage,validateSchedule);if(result)results.push(result);}
  catch(error){results.push(`✗ ${error instanceof Error ? error.message : 'Change could not be saved.'}${i+1<actions.length ? ' Remaining changes were not applied.' : ''}`);break;}
 }
 return results;
}
export async function appendAITodos(items:AiTodo[],storage:AIActionStore):Promise<void>{
 await Promise.all([storage.fetchAllTodos(),storage.fetchSubjects()]);
 for(const item of items){if(!item.text.trim() || (item.subjectId && !storage.getSubjects().some(s=>s.id===item.subjectId && !s.archived)))throw new Error('A proposed task has an invalid title or subject. Nothing was added.');}
 for(const item of items){
  if(storage.getTodos().some(t=>t.text.trim().toLowerCase()===item.text.trim().toLowerCase() && t.subjectId===item.subjectId))continue;
  await storage.saveTodo({id:crypto.randomUUID(),text:item.text.trim(),status:'nothing',subjectId:item.subjectId,assignmentId:item.assignmentId,date:getTodayKey()});
  await storage.fetchAllTodos();
 }
 notify('soma_todos_changed');
}
