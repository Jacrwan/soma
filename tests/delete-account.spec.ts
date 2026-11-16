import { test, expect } from '@playwright/test';
import { deleteUserData, USER_TABLES } from '../api/_deleteUserData';
import { stopBilling } from '../api/delete-account';
import { ownsPath } from '../api/extract-document';

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
  for (const table of ['subjects', 'todos', 'todo_sessions', 'documents', 'chat_sessions', 'soma_ai_memory', 'ai_usage', 'google_calendar_connections', 'timer_sessions', 'settings', 'subscriptions', 'brain_dump_items']) {
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

// A failed cancel used to be ignored and the account deleted anyway, which
// removed the only record of a subscription that kept charging (2026-11-15).
test('an account is not deleted while its subscription could not be canceled', async () => {
  const active = { stripe_subscription_id: 'sub_1', status: 'active' };
  const canceled: string[] = [];
  expect(await stopBilling(active, async id => { canceled.push(id); })).toBe(true);
  expect(canceled).toEqual(['sub_1']);
  expect(await stopBilling(active, async () => { throw new Error('network'); })).toBe(false);
  // No Stripe key on the server: it can't be canceled, so nothing is deleted.
  expect(await stopBilling(active, null)).toBe(false);
});

test('nothing to cancel, or a subscription Stripe no longer has, does not block deleting', async () => {
  const never = async () => { throw new Error('should not be called'); };
  expect(await stopBilling(null, never)).toBe(true);
  expect(await stopBilling({ stripe_subscription_id: null, status: 'free' }, never)).toBe(true);
  expect(await stopBilling({ stripe_subscription_id: 'sub_1', status: 'canceled' }, never)).toBe(true);
  expect(await stopBilling({ stripe_subscription_id: 'sub_1', status: 'active' }, async () => { throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' }); })).toBe(true);
});

// The file's path comes from a row the student can write; the download uses the service role.
test('a document is only extracted from the student’s own folder', () => {
  expect(ownsPath('user-1', 'user-1/abc-notes.pdf')).toBe(true);
  expect(ownsPath('user-1', 'user-2/abc-notes.pdf')).toBe(false);
  expect(ownsPath('user-1', 'user-10/abc-notes.pdf')).toBe(false);
  expect(ownsPath('user-1', 'user-1/../user-2/abc-notes.pdf')).toBe(false);
  expect(ownsPath('user-1', null)).toBe(false);
});
