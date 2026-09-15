import { test, expect } from '@playwright/test';
import { getSubscription } from '../api/stripe';

for (const scenario of ['missing', 'error', 'active'] as const) {
  test(`subscription API distinguishes ${scenario} lookup`, async () => {
    let code = 200;
    let body: unknown;
    const result = {
      data: scenario === 'active' ? { status: 'active', plan: 'monthly' } : null,
      error: scenario === 'error' ? { message: 'Database unavailable' } : null,
    };
    const query = {
      select: () => query, eq: () => query,
      maybeSingle: async () => result, single: async () => result,
    };
    const admin = { from: () => query };
    const response = {
      status: (value: number) => { code = value; return response; },
      json: (value: unknown) => { body = value; return response; },
    };
    await getSubscription({ id: 'student' }, admin, response);
    expect(code).toBe(scenario === 'error' ? 503 : 200);
    expect(body).toMatchObject(scenario === 'error'
      ? { error: expect.any(String) }
      : { status: scenario === 'missing' ? 'free' : 'active' });
  });
}
