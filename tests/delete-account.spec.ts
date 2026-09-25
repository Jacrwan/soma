import { test, expect } from '@playwright/test';
import { deleteUserData, USER_TABLES } from '../api/_deleteUserData';

// Account deletion used to clear a fixed list of nine tables that predated
// courses, documents, chats and calendar connections, and never touched the
// uploaded files in Storage. The Data Deletion page promises all of it goes.
function fakeAdmin(files: string[], failingTables: string[] = []) {
  const deleted: { table: string; column: string; value: string }[] = [];
  const removed: string[] = [];
  let stored = [...files];
  const admin = {
    from: (table: string) => ({
      delete: () => ({
        eq: async (column: string, value: string) => {
          deleted.push({ table, column, value });
          return { error: failingTables.includes(table) ? { message: 'relation does not exist' } : null };
        },
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        list: async (path: string) => ({
          data: bucket === 'documents' ? stored.filter(f => f.startsWith(`${path}/`)).map(f => ({ name: f.slice(path.length + 1) })) : [],
          error: null,
        }),
        remove: async (paths: string[]) => {
          removed.push(...paths);
          stored = stored.filter(f => !paths.includes(f));
          return { error: null };
        },
      }),
    },
  };
  return { admin, deleted, removed };
}

test('deleting an account clears every user table and the uploaded files', async () => {
  const { admin, deleted, removed } = fakeAdmin(['user-1/a.pdf', 'user-1/b.docx', 'someone-else/c.pdf']);
  const failed = await deleteUserData(admin, 'user-1');

  expect(failed).toEqual([]);
  expect(removed.sort()).toEqual(['user-1/a.pdf', 'user-1/b.docx']);
  for (const table of ['subjects', 'todos', 'todo_sessions', 'documents', 'chat_sessions', 'soma_ai_memory', 'google_calendar_connections', 'timer_sessions', 'settings', 'subscriptions']) {
    expect(deleted).toContainEqual({ table, column: 'user_id', value: 'user-1' });
  }
  expect(deleted).toHaveLength(USER_TABLES.length);
});

test('a missing old table is reported but does not stop the rest', async () => {
  const { admin, deleted } = fakeAdmin([], ['schedule_blocks']);
  const failed = await deleteUserData(admin, 'user-1');
  expect(failed).toEqual(['schedule_blocks']);
  expect(deleted.map(d => d.table)).toContain('time_blocks');
});
