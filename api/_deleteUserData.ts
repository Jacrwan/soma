/// <reference types="node" />
// Removes everything Soma stores for one user, before their auth account is
// deleted. The Data Deletion page lists exactly this, so keep them in step.
//
// Several tables also cascade from auth.users, but not all of them are known
// to (subjects and todo_sessions have no migration in this repo), so every
// table is cleared explicitly. Uploaded files live in Storage, which no
// database cascade reaches.

// Tables keyed by user_id. Order matters only for readability: documents and
// sessions reference subjects/todos, and each is deleted by user_id anyway.
export const USER_TABLES = [
  'documents',
  'todo_sessions',
  'timer_sessions',
  'active_timer',
  'todos',
  'subjects',
  'chat_sessions',
  'soma_ai_memory',
  'google_calendar_connections',
  'settings',
  'subscriptions',
  // Older tables that may no longer exist; a missing table is just logged.
  'schedule_blocks',
  'elapsed_time',
  'time_blocks',
  'ai_memory',
] as const;

const DOCUMENTS_BUCKET = 'documents';

interface AdminLike {
  from(table: string): { delete(): { eq(column: string, value: string): PromiseLike<{ error: { message: string } | null }> } };
  storage: {
    from(bucket: string): {
      list(path: string, options: { limit: number; offset: number }): PromiseLike<{ data: { name: string }[] | null; error: { message: string } | null }>;
      remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

/** Returns the names of the steps that failed; they are logged, never fatal. */
export async function deleteUserData(admin: AdminLike, uid: string): Promise<string[]> {
  const failed: string[] = [];

  // Uploaded files sit under "<uid>/" in the documents bucket.
  const bucket = admin.storage.from(DOCUMENTS_BUCKET);
  for (let round = 0; round < 50; round++) {
    const { data, error } = await bucket.list(uid, { limit: 1000, offset: 0 });
    if (error) { failed.push('storage:list'); break; }
    if (!data?.length) break;
    const { error: removeError } = await bucket.remove(data.map(file => `${uid}/${file.name}`));
    if (removeError) { failed.push('storage:remove'); break; }
    if (data.length < 1000) break;
  }

  for (const table of USER_TABLES) {
    const { error } = await admin.from(table).delete().eq('user_id', uid);
    if (error) failed.push(table);
  }
  return failed;
}
